-- Shared business records remain the source of truth; projections are trigger-maintained only.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before scheduling migration' using errcode='55000'; end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
do $$ begin if exists(select 1 from lms.records where entity='appointments') then raise exception 'Untracked appointments require a reviewed migration';end if;end; $$;
create extension if not exists btree_gist;
create table lms_private.record_epochs(organization_id uuid primary key references lms.organizations(id) on delete cascade,epoch bigint not null default 0);
insert into lms_private.record_epochs(organization_id) select id from lms.organizations;
alter table lms_private.record_epochs enable row level security;
alter table lms_private.record_epochs force row level security;
revoke all on lms_private.record_epochs from public,lms_app;
create table lms.record_links (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 source_id uuid not null, field_key text not null, target_id uuid not null, target_entity text not null,
 primary key(organization_id,source_id,field_key),
 foreign key(organization_id,source_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,target_id) references lms.records(organization_id,id)
);
create index record_links_target on lms.record_links(organization_id,target_id,source_id);
create table lms.appointments (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 record_id uuid not null, customer_id uuid not null, work_id uuid not null, resource_id uuid not null,
 starts_at timestamptz not null, ends_at timestamptz not null, time_zone text not null, scheduled_date date not null,
 blocking boolean not null,
 primary key(organization_id,record_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,customer_id) references lms.records(organization_id,id),
 foreign key(organization_id,work_id) references lms.records(organization_id,id),
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at<=starts_at+interval '24 hours'),
 constraint exclusive_resource_time exclude using gist(organization_id with =,resource_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(blocking)
);
create index appointments_work on lms.appointments(organization_id,work_id);
create table lms.record_operations (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 operation_id uuid not null, actor_id uuid not null references lms.users(id), record_id uuid not null,
 request jsonb not null, result jsonb not null,
 primary key(organization_id,operation_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id) on delete cascade
);
alter table lms.record_links enable row level security;
alter table lms.record_links force row level security;
alter table lms.appointments enable row level security;
alter table lms.appointments force row level security;
alter table lms.record_operations enable row level security;
alter table lms.record_operations force row level security;
create policy read_record_links on lms.record_links for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_appointments on lms.appointments for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_own_operations on lms.record_operations for select to lms_app using(actor_id=lms.current_user_id() and lms.has_role(organization_id,array['owner','admin','staff']));
revoke all on lms.record_links,lms.appointments,lms.record_operations from public,lms_app;
grant select on lms.record_links,lms.appointments,lms.record_operations to lms_app;

create function lms_private.relationship_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare config jsonb; definition jsonb; spec jsonb; target lms.records; work_record lms.records; work_definition jsonb; start_time timestamptz; end_time timestamptz; zone text; local_day date;
begin
 if not lms.has_role(new.organization_id,array['owner','admin','staff']) then raise exception 'Record violates row-level security' using errcode='42501'; end if;
 -- A real row version, not just a lock, also rejects stale REPEATABLE READ snapshots.
 insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 select document into config from lms.config_revisions where organization_id=new.organization_id order by revision desc limit 1;
 select e into definition from jsonb_array_elements(config->'entities') e where e->>'id'=new.entity;
 if definition is null or not exists(select 1 from jsonb_array_elements(config->'modules') m where m->>'id'=definition->>'module') then raise exception 'Record entity or module is disabled' using errcode='23514'; end if;
 if tg_op='UPDATE' then
  if old.archived and new.archived and new.data is distinct from old.data then raise exception 'Restore the record before editing it' using errcode='23514'; end if;
  if new.archived and not old.archived and exists(select 1 from lms.record_links l join lms.records r on r.organization_id=l.organization_id and r.id=l.source_id where l.organization_id=new.organization_id and l.target_id=new.id and r.id<>new.id and not r.archived) then raise exception 'Archive linked active records first; history is retained' using errcode='23514'; end if;
  if ((old.data->>'customer',nullif(old.data->>'site','')) is distinct from (new.data->>'customer',nullif(new.data->>'site',''))) and exists(select 1 from lms.appointments where organization_id=new.organization_id and work_id=new.id) then raise exception 'Scheduled work retains its customer and site links; create a new work record' using errcode='23514'; end if;
 end if;
 for spec in select f from jsonb_array_elements(definition->'fields') f where f->>'type'='reference' loop
  if nullif(new.data->>(spec->>'key'),'') is null then
   if (spec->>'required')::boolean then raise exception 'Required related record is unavailable' using errcode='23514'; end if;
   continue;
  end if;
  select * into target from lms.records where organization_id=new.organization_id and id=(new.data->>(spec->>'key'))::uuid and entity=spec->>'target';
  if not found then raise exception 'Related records must belong to this workspace and match their target entity' using errcode='23514'; end if;
  if (target.archived or not exists(select 1 from jsonb_array_elements(config->'modules') m join jsonb_array_elements(config->'entities') e on e->>'module'=m->>'id' where e->>'id'=spec->>'target')) and (tg_op='INSERT' or old.data->>(spec->>'key') is distinct from new.data->>(spec->>'key') or old.archived and not new.archived) then raise exception 'New or restored links require active related records' using errcode='23514'; end if;
 end loop;
 if new.entity='appointments' then
  if tg_op='UPDATE' and (old.data->>'customer',old.data->>'work',nullif(old.data->>'site','')) is distinct from (new.data->>'customer',new.data->>'work',nullif(new.data->>'site','')) then raise exception 'Appointment customer, work and site links are retained; archive and create a new appointment' using errcode='23514'; end if;
  if definition->>'module'<>'scheduling' or not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'resource')::uuid and entity='resources') or not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'customer')::uuid and entity='customers') then raise exception 'Appointment customer or resource is unavailable' using errcode='23514'; end if;
  select * into work_record from lms.records where organization_id=new.organization_id and id=(new.data->>'work')::uuid;
  select e into work_definition from jsonb_array_elements(config->'entities') e where e->>'id'=work_record.entity;
  if work_record.id is null or work_record.data->>'customer' is distinct from new.data->>'customer' or not exists(select 1 from jsonb_array_elements(work_definition->'fields') f where f->>'key'='customer' and f->>'type'='reference' and f->>'target'='customers') or (nullif(work_record.data->>'site','') is not null and work_record.data->>'site' is distinct from new.data->>'site') then raise exception 'Link the work record to this customer and site before scheduling' using errcode='23514'; end if;
  zone:=new.data->>'time_zone';
  if zone is null or length(zone)>80 or not(zone='UTC' or position('/' in zone)>0) or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Use a valid IANA booking time zone' using errcode='23514'; end if;
  if coalesce(new.data->>'start','') !~ '^\d{4}-.+(Z|[+-]\d{2}:\d{2})$' or coalesce(new.data->>'end','') !~ '^\d{4}-.+(Z|[+-]\d{2}:\d{2})$' then raise exception 'Use explicit offsets for appointment times' using errcode='23514'; end if;
  start_time:=(new.data->>'start')::timestamptz; end_time:=(new.data->>'end')::timestamptz; local_day:=(new.data->>'scheduled_date')::date;
  if not isfinite(start_time) or not isfinite(end_time) or end_time<=start_time or end_time>start_time+interval '24 hours' or date_trunc('minute',start_time at time zone 'UTC')<>start_time at time zone 'UTC' or date_trunc('minute',end_time at time zone 'UTC')<>end_time at time zone 'UTC' or local_day is null or local_day<>(start_time at time zone zone)::date or local_day not between date '2020-01-01' and date '2100-12-31' or to_char(local_day,'YYYY-MM-DD')<>new.data->>'scheduled_date' or coalesce(new.data->>'status','') not in ('Scheduled','In progress','Completed','Cancelled') then raise exception 'Invalid appointment range, precision, date or status' using errcode='23514'; end if;
 end if;
 return new;
end; $$;
revoke all on function lms_private.relationship_guard() from public,lms_app;
create trigger record_relationship_guard before insert or update on lms.records for each row execute function lms_private.relationship_guard();

create function lms_private.relationship_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare definition jsonb; spec jsonb; command jsonb:=nullif(current_setting('lms.record_command',true),'')::jsonb; request jsonb;
begin
 select e into definition from lms.config_revisions c cross join lateral jsonb_array_elements(c.document->'entities') e where c.organization_id=new.organization_id and e->>'id'=new.entity order by c.revision desc limit 1;
 delete from lms.record_links where organization_id=new.organization_id and source_id=new.id;
 for spec in select f from jsonb_array_elements(definition->'fields') f where f->>'type'='reference' and nullif(new.data->>(f->>'key'),'') is not null loop
  insert into lms.record_links values(new.organization_id,new.id,spec->>'key',(new.data->>(spec->>'key'))::uuid,spec->>'target');
 end loop;
 if new.entity='appointments' then
  insert into lms.appointments values(new.organization_id,new.id,(new.data->>'customer')::uuid,(new.data->>'work')::uuid,(new.data->>'resource')::uuid,(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,new.data->>'time_zone',(new.data->>'scheduled_date')::date,not new.archived and new.data->>'status'<>'Cancelled')
  on conflict(organization_id,record_id) do update set customer_id=excluded.customer_id,work_id=excluded.work_id,resource_id=excluded.resource_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,time_zone=excluded.time_zone,scheduled_date=excluded.scheduled_date,blocking=excluded.blocking;
 end if;
 if command is not null then
  request:=command->'request';
  if request->>'kind'='save' then
   if request->>'entity' is distinct from new.entity or request->'data' is distinct from new.data or new.archived or (tg_op='INSERT' and request->'existing'<>'null'::jsonb) or (tg_op='UPDATE' and (request->'existing'->>'id' is distinct from new.id::text or (request->'existing'->>'revision')::integer is distinct from old.revision or old.archived)) then raise exception 'Record command does not match its mutation' using errcode='23514'; end if;
  elsif request->>'kind'='archive' then
   if tg_op<>'UPDATE' or request->>'recordId' is distinct from new.id::text or (request->>'revision')::integer is distinct from old.revision or (request->>'archived')::boolean is distinct from new.archived or new.data is distinct from old.data then raise exception 'Archive command does not match its mutation' using errcode='23514'; end if;
  else raise exception 'Unsupported record command' using errcode='23514'; end if;
  insert into lms.record_operations values(new.organization_id,(command->>'operationId')::uuid,lms.current_user_id(),new.id,request,to_jsonb(new));
 end if;
 return new;
end; $$;
revoke all on function lms_private.relationship_projection() from public,lms_app;
create trigger record_relationship_projection after insert or update on lms.records for each row execute function lms_private.relationship_projection();

create function lms_private.relationship_config_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare prior jsonb; old_entity jsonb; next_entity jsonb;
begin
 insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 select document into prior from lms.config_revisions where organization_id=new.organization_id order by revision desc limit 1;
 for old_entity in select e from jsonb_array_elements(prior->'entities') e loop
  if exists(select 1 from lms.records where organization_id=new.organization_id and entity=old_entity->>'id') then
   select e into next_entity from jsonb_array_elements(new.document->'entities') e where e->>'id'=old_entity->>'id';
   if next_entity is null or (next_entity->'fields',next_entity->>'module',next_entity->>'titleField') is distinct from (old_entity->'fields',old_entity->>'module',old_entity->>'titleField') then raise exception 'Populated entity fields require a reviewed schema migration' using errcode='23514'; end if;
  end if;
 end loop;
 return new;
end; $$;
revoke all on function lms_private.relationship_config_guard() from public,lms_app;
create trigger config_relationship_guard before insert on lms.config_revisions for each row execute function lms_private.relationship_config_guard();
-- Historical configurations/data are preserved. No new relationship or appointment is fabricated.
