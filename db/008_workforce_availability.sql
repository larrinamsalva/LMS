-- Additive workforce contracts. Existing resource-only appointments stay unchanged.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then
  raise exception 'Stop runtime hosts before workforce migration' using errcode='55000';
 end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
do $$ begin
 if exists(select 1 from lms.records where entity in ('employees','resource-memberships','availability')) then
  raise exception 'Untracked workforce records require a reviewed migration';
 end if;
end; $$;

create table lms.resource_memberships (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 record_id uuid not null, resource_id uuid not null, employee_id uuid not null,
 starts_at timestamptz not null, ends_at timestamptz not null,
 resource_kind text not null check(resource_kind in ('Worker','Crew')),
 revision integer not null, archived boolean not null,
 primary key(organization_id,record_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 foreign key(organization_id,employee_id) references lms.records(organization_id,id),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at),
 constraint unique_crew_membership exclude using gist(organization_id with =,resource_id with =,employee_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(not archived),
 constraint one_worker_identity exclude using gist(organization_id with =,resource_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(not archived and resource_kind='Worker')
);
create index resource_memberships_employee on lms.resource_memberships(organization_id,employee_id);
create table lms.availability_windows (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 record_id uuid not null, employee_id uuid, resource_id uuid,
 starts_at timestamptz not null, ends_at timestamptz not null,
 kind text not null check(kind in ('Working hours','Day off','Vacation','Unavailable')),
 archived boolean not null,
 primary key(organization_id,record_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,employee_id) references lms.records(organization_id,id),
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 check((employee_id is null)<>(resource_id is null)),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at)
);
create index availability_employee on lms.availability_windows(organization_id,employee_id,starts_at);
create index availability_resource on lms.availability_windows(organization_id,resource_id,starts_at);
create table lms.appointment_staff (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 appointment_id uuid not null, appointment_revision integer not null,
 employee_id uuid not null, resource_id uuid not null,
 membership_id uuid not null, membership_revision integer not null,
 member_start timestamptz not null, member_end timestamptz not null,
 employee_name text not null, employee_role text not null, employee_skills text not null,
 starts_at timestamptz not null, ends_at timestamptz not null,
 active boolean not null,
 primary key(organization_id,appointment_id,appointment_revision,employee_id),
 foreign key(organization_id,appointment_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,employee_id) references lms.records(organization_id,id),
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 foreign key(organization_id,membership_id) references lms.records(organization_id,id),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at),
 constraint exclusive_employee_time exclude using gist(organization_id with =,employee_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(active)
);
create index appointment_staff_appointment on lms.appointment_staff(organization_id,appointment_id,active);
alter table lms.resource_memberships enable row level security;
alter table lms.resource_memberships force row level security;
alter table lms.availability_windows enable row level security;
alter table lms.availability_windows force row level security;
alter table lms.appointment_staff enable row level security;
alter table lms.appointment_staff force row level security;
create policy read_resource_memberships on lms.resource_memberships for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_availability on lms.availability_windows for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_appointment_staff on lms.appointment_staff for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
revoke all on lms.resource_memberships,lms.availability_windows,lms.appointment_staff from public,lms_app;
grant select on lms.resource_memberships,lms.availability_windows,lms.appointment_staff to lms_app;

create function lms_private.workforce_period(data jsonb, max_hours integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare s timestamptz; e timestamptz; zone text:=data->>'time_zone';
begin
 if zone is null or length(zone)>80 or not(zone='UTC' or position('/' in zone)>0)
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then
  raise exception 'Use a valid IANA availability or membership time zone' using errcode='23514';
 end if;
 if coalesce(data->>'start','') !~ '^\d{4}-.+(Z|[+-]\d{2}:\d{2})$'
    or coalesce(data->>'end','') !~ '^\d{4}-.+(Z|[+-]\d{2}:\d{2})$' then
  raise exception 'Use explicit offsets for workforce periods' using errcode='23514';
 end if;
 s:=(data->>'start')::timestamptz; e:=(data->>'end')::timestamptz;
 if not isfinite(s) or not isfinite(e) or e<=s
    or date_trunc('minute',s at time zone 'UTC')<>s at time zone 'UTC'
    or date_trunc('minute',e at time zone 'UTC')<>e at time zone 'UTC'
    or (s at time zone zone)::date not between date '2020-01-01' and date '2100-12-31'
    or (e at time zone zone)::date not between date '2020-01-01' and date '2100-12-31'
    or (max_hours is not null and e>s+max_hours*interval '1 hour') then
  raise exception 'Invalid workforce period: use positive whole-minute ranges within the supported dates and duration' using errcode='23514';
 end if;
end; $$;

create function lms_private.assert_subject_available(org uuid, person uuid, resource uuid, s timestamptz, e timestamptz, require_work boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from lms.availability_windows w where w.organization_id=org and not w.archived
   and (w.employee_id=person or w.resource_id=resource) and w.kind<>'Working hours'
   and tstzrange(w.starts_at,w.ends_at,'[)') && tstzrange(s,e,'[)')) then
  raise exception 'Employee or resource is unavailable during this appointment' using errcode='23514';
 end if;
 if (require_work or exists(select 1 from lms.availability_windows w where w.organization_id=org and not w.archived
      and (w.employee_id=person or w.resource_id=resource) and w.kind='Working hours'))
    and not exists(select 1 from lms.availability_windows w where w.organization_id=org and not w.archived
      and (w.employee_id=person or w.resource_id=resource) and w.kind='Working hours' and w.starts_at<=s and w.ends_at>=e) then
  raise exception 'Appointment must fit within a published employee or resource work window' using errcode='23514';
 end if;
end; $$;

create function lms_private.workforce_roster(org uuid, resource uuid, s timestamptz, e timestamptz)
returns table(employee_id uuid,membership_id uuid,membership_revision integer,member_start timestamptz,member_end timestamptz,employee_name text,employee_role text,employee_skills text)
language plpgsql security definer set search_path='' as $$
declare member record;
begin
 perform lms_private.assert_subject_available(org,null,resource,s,e,false);
 -- An enrollment is permanent even when all dated memberships are archived.
 -- Unenrolled PR #10 resources keep resource-only scheduling without pretending to reserve a person.
 if not exists(select 1 from lms.resource_memberships m where m.organization_id=org and m.resource_id=resource) then return; end if;
 if not exists(select 1 from lms.resource_memberships m where m.organization_id=org and m.resource_id=resource
      and not m.archived and m.starts_at<=s and m.ends_at>=e)
    or exists(select 1 from lms.resource_memberships m where m.organization_id=org and m.resource_id=resource and not m.archived
      and tstzrange(m.starts_at,m.ends_at,'[)') && tstzrange(s,e,'[)') and (m.starts_at>s or m.ends_at<e)) then
  raise exception 'A staffed resource needs a stable, effective roster covering the entire appointment' using errcode='23514';
 end if;
 for member in select m.*,r.data,r.archived as employee_archived from lms.resource_memberships m
    join lms.records r on r.organization_id=m.organization_id and r.id=m.employee_id and r.entity='employees'
    where m.organization_id=org and m.resource_id=resource and not m.archived and m.starts_at<=s and m.ends_at>=e loop
  if member.employee_archived or member.data->>'status' is distinct from 'Active' then
   raise exception 'Assigned employees must have active fictional profiles' using errcode='23514';
  end if;
  perform lms_private.assert_subject_available(org,member.employee_id,null,s,e,true);
  employee_id:=member.employee_id; membership_id:=member.record_id; membership_revision:=member.revision;
  member_start:=member.starts_at; member_end:=member.ends_at;
  employee_name:=member.data->>'name'; employee_role:=member.data->>'role'; employee_skills:=coalesce(member.data->>'skills','');
  return next;
 end loop;
end; $$;

create function lms_private.workforce_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare resource lms.records; person lms.records; definition jsonb;
begin
 -- record_relationship_guard runs first and advances the existing organization epoch.
 -- All following reads therefore share its mutation ordering (including REPEATABLE READ failure).
 if new.entity in ('employees','resource-memberships','availability') then
  if not lms.has_role(new.organization_id,array['owner','admin']) then
   raise exception 'Only owners or admins manage fictional employee profiles, membership and availability' using errcode='42501';
  end if;
  select e into definition from lms.config_revisions c cross join lateral jsonb_array_elements(c.document->'entities') e
   where c.organization_id=new.organization_id and e->>'id'=new.entity order by c.revision desc limit 1;
  if definition->>'module' is distinct from 'workforce' then raise exception 'Workforce entity contract is required' using errcode='23514'; end if;
 end if;
 if new.entity='employees' then
  if nullif(btrim(new.data->>'name'),'') is null or nullif(btrim(new.data->>'role'),'') is null
     or coalesce(new.data->>'status','') not in ('Active','Inactive') then
   raise exception 'Employee name, descriptive role and status are required' using errcode='23514';
  end if;
 elsif new.entity='resource-memberships' then
  perform lms_private.workforce_period(new.data);
  if tg_op='UPDATE' and (old.data->>'employee',old.data->>'resource') is distinct from (new.data->>'employee',new.data->>'resource') then
   raise exception 'Membership employee and resource links are retained; archive and create another membership' using errcode='23514';
  end if;
  select * into resource from lms.records where organization_id=new.organization_id and id=(new.data->>'resource')::uuid and entity='resources';
  select * into person from lms.records where organization_id=new.organization_id and id=(new.data->>'employee')::uuid and entity='employees';
  if resource.id is null or person.id is null or resource.data->>'kind' not in ('Worker','Crew') then
   raise exception 'Membership needs a same-workspace employee and Worker or Crew resource' using errcode='23514';
  end if;
  if not exists(select 1 from lms.resource_memberships where organization_id=new.organization_id and resource_id=resource.id)
      and exists(select 1 from lms.appointments where organization_id=new.organization_id and resource_id=resource.id and blocking) then
   raise exception 'Archive or cancel existing resource-only appointments before enrolling this resource' using errcode='23514';
  end if;
  if tg_op='INSERT' or (old.data->>'employee',old.data->>'resource',old.data->>'start',old.data->>'end',old.archived)
       is distinct from (new.data->>'employee',new.data->>'resource',new.data->>'start',new.data->>'end',new.archived) then
   if exists(select 1 from lms.appointments a where a.organization_id=new.organization_id and a.blocking and
      ((a.resource_id=resource.id and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange((new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,'[)'))
       or (tg_op='UPDATE' and a.resource_id=(old.data->>'resource')::uuid and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange((old.data->>'start')::timestamptz,(old.data->>'end')::timestamptz,'[)')))) then
    raise exception 'Membership change would affect reserved work; archive or cancel those appointments first' using errcode='23514';
   end if;
  end if;
 elsif new.entity='availability' then
  perform lms_private.workforce_period(new.data,case when new.data->>'kind'='Working hours' then 24 else 8784 end);
  if (nullif(new.data->>'employee','') is null)=(nullif(new.data->>'resource','') is null)
     or coalesce(new.data->>'kind','') not in ('Working hours','Day off','Vacation','Unavailable') then
   raise exception 'Availability needs exactly one employee or resource and a supported period type' using errcode='23514';
  end if;
  if nullif(new.data->>'employee','') is not null and not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'employee')::uuid and entity='employees')
    or nullif(new.data->>'resource','') is not null and not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'resource')::uuid and entity='resources') then
   raise exception 'Availability targets must belong to this workspace and have the correct type' using errcode='23514';
  end if;
 elsif new.entity='resources' and tg_op='UPDATE' and new.data->>'kind' is distinct from old.data->>'kind'
    and exists(select 1 from lms.resource_memberships where organization_id=new.organization_id and resource_id=new.id) then
  raise exception 'An enrolled resource retains its Worker or Crew type' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger record_workforce_guard before insert or update on lms.records for each row execute function lms_private.workforce_guard();

create function lms_private.workforce_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare a record; member record;
begin
 if new.entity='resource-memberships' then
  insert into lms.resource_memberships values(new.organization_id,new.id,(new.data->>'resource')::uuid,(new.data->>'employee')::uuid,
   (new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,
   (select data->>'kind' from lms.records where organization_id=new.organization_id and id=(new.data->>'resource')::uuid),new.revision,new.archived)
  on conflict(organization_id,record_id) do update set resource_id=excluded.resource_id,employee_id=excluded.employee_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,resource_kind=excluded.resource_kind,revision=excluded.revision,archived=excluded.archived;
 elsif new.entity='availability' then
  insert into lms.availability_windows values(new.organization_id,new.id,nullif(new.data->>'employee','')::uuid,nullif(new.data->>'resource','')::uuid,
   (new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,new.data->>'kind',new.archived)
  on conflict(organization_id,record_id) do update set employee_id=excluded.employee_id,resource_id=excluded.resource_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,kind=excluded.kind,archived=excluded.archived;
 elsif new.entity='appointments' then
  update lms.appointment_staff set active=false where organization_id=new.organization_id and appointment_id=new.id and active;
  if not new.archived and new.data->>'status'<>'Cancelled' then
   for member in select * from lms_private.workforce_roster(new.organization_id,(new.data->>'resource')::uuid,(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz) loop
    insert into lms.appointment_staff values(new.organization_id,new.id,new.revision,member.employee_id,(new.data->>'resource')::uuid,
     member.membership_id,member.membership_revision,member.member_start,member.member_end,member.employee_name,member.employee_role,member.employee_skills,
     (new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,true);
   end loop;
  end if;
 end if;
 if new.entity in ('employees','resource-memberships','availability') then
  -- Reject changes that invalidate any existing reservation; never silently reassign its people.
  for a in select * from lms.appointments where organization_id=new.organization_id and blocking loop
   perform * from lms_private.workforce_roster(new.organization_id,a.resource_id,a.starts_at,a.ends_at);
  end loop;
 end if;
 return new;
end; $$;
create trigger record_workforce_projection after insert or update on lms.records for each row execute function lms_private.workforce_projection();
revoke all on function lms_private.workforce_period(jsonb,integer),lms_private.assert_subject_available(uuid,uuid,uuid,timestamptz,timestamptz,boolean),lms_private.workforce_roster(uuid,uuid,timestamptz,timestamptz),lms_private.workforce_guard(),lms_private.workforce_projection() from public,lms_app;
