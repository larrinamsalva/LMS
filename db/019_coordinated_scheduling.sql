-- One current-allocation authority for every primary and optional equipment resource.
-- Historical migrations remain unchanged. Installation is transactional with all runtime hosts stopped.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before coordinated scheduling migration' using errcode='55000';end if;
end; $$;
lock table lms.records,lms.config_revisions,lms.appointments,lms.equipment_resource_mappings in access exclusive mode nowait;

do $$ begin
 if exists(select 1 from lms.records r full join lms.appointments a on a.organization_id=r.organization_id and a.record_id=r.id
   where (r.entity='appointments' or a.record_id is not null) and
   (r.id is null or a.record_id is null or r.entity<>'appointments'
    or a.customer_id is distinct from (r.data->>'customer')::uuid or a.work_id is distinct from (r.data->>'work')::uuid
    or a.resource_id is distinct from (r.data->>'resource')::uuid or a.starts_at is distinct from (r.data->>'start')::timestamptz
    or a.ends_at is distinct from (r.data->>'end')::timestamptz or a.time_zone is distinct from r.data->>'time_zone'
    or a.scheduled_date is distinct from (r.data->>'scheduled_date')::date or a.blocking is distinct from (not r.archived and r.data->>'status'<>'Cancelled')))
 or exists(select 1 from lms.appointments a left join lms.records r on r.organization_id=a.organization_id and r.id=a.resource_id
   where r.entity is distinct from 'resources' or coalesce(r.data->>'kind','') not in ('Worker','Crew','Equipment')) then
  raise exception 'Legacy appointment evidence is ambiguous; restore source consistency under separate review before migration' using errcode='23514';
 end if;
end; $$;

create table lms.appointment_resource_allocations (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 appointment_id uuid not null,slot text not null check(slot in ('Primary','Equipment')),
 appointment_revision integer not null check(appointment_revision>0),config_revision integer not null,
 resource_id uuid not null,resource_revision integer not null check(resource_revision>0),resource_name text not null,
 resource_kind text not null check(resource_kind in ('Worker','Crew','Equipment')),
 equipment_id uuid,equipment_revision integer,mapping_revision integer,equipment_asset_id text,
 starts_at timestamptz not null,ends_at timestamptz not null,blocking boolean not null,present boolean not null,
 recorded_by uuid not null references lms.users(id),operation_id uuid,
 origin text not null check(origin in ('Reviewed','Single resource','Legacy observed','Retained release')),recorded_at timestamptz not null default now(),
 primary key(organization_id,appointment_id,slot),
 foreign key(organization_id,appointment_id) references lms.appointments(organization_id,record_id) on delete cascade,
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision),
 foreign key(organization_id,equipment_id,mapping_revision) references lms.equipment_mapping_history(organization_id,equipment_id,revision),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at<=starts_at+interval '24 hours'),
 check(present or not blocking),
 check((equipment_id is null and equipment_revision is null and mapping_revision is null and equipment_asset_id is null)
   or (equipment_id is not null and equipment_revision>0 and mapping_revision>0 and equipment_asset_id is not null and resource_kind='Equipment')),
 check(slot<>'Equipment' or resource_kind='Equipment' and equipment_id is not null)
);
create unique index distinct_appointment_resources on lms.appointment_resource_allocations(organization_id,appointment_id,resource_id) where(present);
create index allocation_resource on lms.appointment_resource_allocations(organization_id,resource_id,starts_at) where(present and blocking);
create table lms.appointment_allocation_history (like lms.appointment_resource_allocations including defaults including constraints);
alter table lms.appointment_allocation_history add primary key(organization_id,appointment_id,appointment_revision,slot),
 add foreign key(organization_id) references lms.organizations(id) on delete cascade,
 add foreign key(organization_id,appointment_id) references lms.appointments(organization_id,record_id) on delete cascade,
 add foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 add foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision),
 add foreign key(organization_id,equipment_id,mapping_revision) references lms.equipment_mapping_history(organization_id,equipment_id,revision),
 add foreign key(recorded_by) references lms.users(id);
-- Adopt only the exact current booking. Labels/revisions are explicitly migration-time observations,
-- not invented evidence about resources at an earlier historical revision.
insert into lms.appointment_resource_allocations
 select a.organization_id,a.record_id,'Primary',r.revision,r.config_revision,a.resource_id,res.revision,res.data->>'name',res.data->>'kind',
 e.equipment_id,e.equipment_revision,e.mapping_revision,eq.data->>'asset_id',a.starts_at,a.ends_at,a.blocking,true,r.updated_by,null,'Legacy observed',now()
 from lms.appointments a join lms.records r on r.organization_id=a.organization_id and r.id=a.record_id
 join lms.records res on res.organization_id=a.organization_id and res.id=a.resource_id
 left join lms.equipment_reservations e on e.organization_id=a.organization_id and e.appointment_id=a.record_id and e.appointment_revision=r.revision and e.resource_id=a.resource_id
 left join lms.records eq on eq.organization_id=e.organization_id and eq.id=e.equipment_id;
insert into lms.appointment_allocation_history select * from lms.appointment_resource_allocations;
-- Atomic replacement: failure restores the original constraint and every legacy row.
alter table lms.appointments drop constraint exclusive_resource_time;
alter table lms.appointment_resource_allocations add constraint exclusive_resource_time
 exclude using gist(organization_id with =,resource_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(present and blocking);

alter table lms.appointment_resource_allocations enable row level security;
alter table lms.appointment_resource_allocations force row level security;
alter table lms.appointment_allocation_history enable row level security;
alter table lms.appointment_allocation_history force row level security;
revoke all on lms.appointment_resource_allocations,lms.appointment_allocation_history from public,lms_app;
grant select on lms.appointment_resource_allocations,lms.appointment_allocation_history to lms_app;
create policy read_resource_allocations on lms.appointment_resource_allocations for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_allocation_history on lms.appointment_allocation_history for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create function lms_private.allocation_history_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Same narrow whole-sandbox expiry boundary as the existing inventory guard. Runtime cannot delete organizations.
 if tg_op='DELETE' and not exists(select 1 from lms.organizations where id=old.organization_id) then return old;end if;
 raise exception 'Allocation history is retained; use an appointment revision' using errcode='23514';
end; $$;
create trigger allocation_history_immutable before update or delete on lms.appointment_allocation_history for each row execute function lms_private.allocation_history_guard();
create trigger allocation_current_retained before delete on lms.appointment_resource_allocations for each row execute function lms_private.allocation_history_guard();

-- Extract PR #33's authoritative machine checks for use by either allocation slot.
create function lms_private.equipment_booking(org uuid,resource_id uuid,ends_at timestamptz,strict_mapping boolean default false)
returns lms.equipment_resource_mappings language plpgsql security definer set search_path='' as $$
declare cfg jsonb;resource lms.records;machine lms.records;s lms.equipment_state;m lms.equipment_resource_mappings;enrolled boolean;
begin
 select document into cfg from lms.config_revisions where organization_id=org order by revision desc limit 1;
 select * into resource from lms.records where organization_id=org and id=resource_id and entity='resources';
 enrolled:=exists(select 1 from lms.equipment_mapping_history h where h.organization_id=org and h.resource_id=resource.id);
 if not strict_mapping and not enrolled and not (resource.data->>'kind'='Equipment' and exists(select 1 from jsonb_array_elements(cfg->'modules') v where v->>'id'='equipment-reservations')) then return m;end if;
 select * into m from lms.equipment_resource_mappings h where h.organization_id=org and h.resource_id=resource.id and h.active;
 select * into s from lms.equipment_state where organization_id=org and record_id=m.equipment_id;
 select * into machine from lms.records where organization_id=org and id=m.equipment_id;
 if not exists(select 1 from jsonb_array_elements(cfg->'modules') v where v->>'id'='equipment-reservations')
 or resource.id is null or resource.archived or resource.data->>'kind' is distinct from 'Equipment'
 or m.equipment_id is null or machine.archived or s.revision is distinct from machine.revision
 or s.condition is distinct from 'Serviceable' or s.maintenance is distinct from 'Clear' then
  raise exception 'Equipment is unmapped, disabled or unsafe; review the physical machine before reserving' using errcode='23514';end if;
 if exists(select 1 from lms.equipment_checkouts where organization_id=org and equipment_id=m.equipment_id and returned_at is null) then
  raise exception 'Equipment is currently checked out; a future return is not a collection guarantee' using errcode='23514';end if;
 if s.next_inspection is not null and ((ends_at-interval '1 microsecond') at time zone coalesce(cfg->>'timeZone','UTC'))::date>=s.next_inspection then
  raise exception 'Equipment inspection is due before this reservation completes; review service first' using errcode='23514';end if;
 return m;
end; $$;
create or replace function lms_private.equipment_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from lms.organizations where id=new.organization_id for update;
 begin perform lms_private.equipment_operator(new.organization_id,'checkout');
 exception when insufficient_privilege then raise exception 'Record violates row-level security' using errcode='42501';end;
 insert into lms_private.record_epochs values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 if new.entity='resources' then
  if exists(select 1 from lms.equipment_mapping_history where organization_id=new.organization_id and resource_id=new.id) and new.data->>'kind' is distinct from 'Equipment' then raise exception 'An enrolled Equipment resource retains its physical type' using errcode='23514';end if;
  if new.archived and exists(select 1 from lms.equipment_resource_mappings where organization_id=new.organization_id and resource_id=new.id and active) then raise exception 'Explicitly unmap equipment before archiving its resource' using errcode='23514';end if;
 elsif new.entity='appointments' and not new.archived and new.data->>'status'<>'Cancelled' then
  perform lms_private.equipment_booking(new.organization_id,(new.data->>'resource')::uuid,(new.data->>'end')::timestamptz);
 end if;
 return new;
end; $$;

create function lms_private.coordinated_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare command jsonb:=nullif(current_setting('lms.record_command',true),'')::jsonb;review jsonb;cfg lms.config_revisions;primary_resource lms.records;extra lms.records;machine lms.records;m lms.equipment_resource_mappings;prior lms.appointment_resource_allocations;blocking boolean;
begin
 if new.entity='resources' then
  if new.data->>'kind' not in ('Crew','Worker') and exists(select 1 from lms.appointment_resource_allocations a where a.organization_id=new.organization_id and a.resource_id=new.id and a.slot='Primary' and a.present and a.blocking and exists(select 1 from lms.appointment_resource_allocations e where e.organization_id=a.organization_id and e.appointment_id=a.appointment_id and e.slot='Equipment' and e.present)) then raise exception 'A coordinated primary resource retains its Crew/Worker identity while reserved' using errcode='23514';end if;
  return new;
 end if;
 if new.entity<>'appointments' then return new;end if;
 select * into prior from lms.appointment_resource_allocations where organization_id=new.organization_id and appointment_id=new.id and slot='Equipment' and present;
 blocking:=not new.archived and new.data->>'status'<>'Cancelled';review:=command->'request'->'resources';
 if review is null then
  if prior.appointment_id is not null then
   if blocking then raise exception 'Review both current resources before editing or restoring this coordinated appointment' using errcode='23514';end if;
   if tg_op='UPDATE' and new.data->>'resource' is distinct from old.data->>'resource' then raise exception 'Release the appointment without changing its retained resource identities' using errcode='23514';end if;
  end if;
  return new;
 end if;
 select * into cfg from lms.config_revisions where organization_id=new.organization_id order by revision desc limit 1;
 if not exists(select 1 from jsonb_array_elements(cfg.document->'modules') x where x->>'id'='coordinated-scheduling' and x->>'version'='1.0.0') then raise exception 'Coordinated scheduling is disabled; retain history and review configuration first' using errcode='23514';end if;
 if command->>'operationId' is null or command->'request'->>'kind' not in ('save','archive') or jsonb_typeof(review) is distinct from 'object'
 or (select array_agg(k order by k) from jsonb_object_keys(review) k) is distinct from array['acknowledgement','configRevision','equipment','primaryId','primaryRevision','version']::text[]
 or review->'version' is distinct from '1'::jsonb or review->>'acknowledgement' is distinct from 'CONFIRM FICTIONAL RESOURCE RESERVATION'
 or review->>'primaryId' is distinct from new.data->>'resource'
 or exists(select 1 from unnest(array['configRevision','primaryRevision']) k where jsonb_typeof(review->k) is distinct from 'number' or (review->>k) !~ '^[1-9][0-9]*$')
 or (review->>'configRevision')::integer is distinct from cfg.revision or new.config_revision<>cfg.revision then raise exception 'Review exact current configuration and resource revisions and explicitly confirm both commitments' using errcode='23514';end if;
 primary_resource:=lms_private.equipment_reference(new.organization_id,(review->>'primaryId')::uuid,(review->>'primaryRevision')::integer,array['resources']);
 if primary_resource.data->>'kind' not in ('Worker','Crew') then raise exception 'Coordinated appointments need a Crew or Worker primary resource' using errcode='23514';end if;
 if review->'equipment'='null'::jsonb then return new;end if;
 review:=review->'equipment';
 if jsonb_typeof(review) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(review) k) is distinct from array['equipmentId','equipmentRevision','mappingRevision','resourceId','resourceRevision']::text[]
 or exists(select 1 from unnest(array['equipmentRevision','mappingRevision','resourceRevision']) k where jsonb_typeof(review->k) is distinct from 'number' or (review->>k) !~ '^[1-9][0-9]*$') then raise exception 'Use one exact reviewed Equipment allocation, without unsupported fields' using errcode='23514';end if;
 extra:=lms_private.equipment_reference(new.organization_id,(review->>'resourceId')::uuid,(review->>'resourceRevision')::integer,array['resources']);
 machine:=lms_private.equipment_reference(new.organization_id,(review->>'equipmentId')::uuid,(review->>'equipmentRevision')::integer,array['equipment']);
 m:=lms_private.equipment_booking(new.organization_id,extra.id,(new.data->>'end')::timestamptz,true);
 if m.equipment_id is distinct from machine.id or m.revision is distinct from (review->>'mappingRevision')::integer then raise exception 'Equipment mapping changed; review its exact destination identity and revision' using errcode='23514';end if;
 perform lms_private.assert_subject_available(new.organization_id,null,extra.id,(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,false);
 return new;
end; $$;
create trigger record_h_coordinated_guard before insert or update on lms.records for each row execute function lms_private.coordinated_guard();

create function lms_private.mapping_allocation_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from lms.appointment_resource_allocations a where a.organization_id=new.organization_id and a.present and a.blocking and
 (a.resource_id=new.resource_id or a.equipment_id=new.equipment_id or a.resource_id in(select h.resource_id from lms.equipment_mapping_history h where h.organization_id=new.organization_id and h.equipment_id=new.equipment_id))) then raise exception 'Retained blocking primary or additional reservations prevent mapping changes' using errcode='23514';end if;
 return new;
end; $$;
create trigger mapping_allocation_guard before insert or update on lms.equipment_resource_mappings for each row execute function lms_private.mapping_allocation_guard();

-- The shared projector now emits physical snapshots for either slot, replacing the primary-only projector.
drop trigger record_equipment_reservation_projection on lms.records;
create function lms_private.coordinated_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare command jsonb:=nullif(current_setting('lms.record_command',true),'')::jsonb;review jsonb;resource lms.records;machine lms.records;m lms.equipment_resource_mappings;prior lms.appointment_resource_allocations;row_data lms.appointment_resource_allocations;slot_name text;selected uuid;cfg integer;is_blocking boolean;is_present boolean;origin text;
begin
 if new.entity<>'appointments' then return new;end if;
 review:=command->'request'->'resources';is_blocking:=not new.archived and new.data->>'status'<>'Cancelled';
 select * into prior from lms.appointment_resource_allocations where organization_id=new.organization_id and appointment_id=new.id and slot='Equipment';
 update lms.appointment_resource_allocations set blocking=false where organization_id=new.organization_id and appointment_id=new.id;
 for slot_name in select unnest(array['Primary','Equipment']) loop
  is_present:=true;selected:=null;
  if slot_name='Primary' then selected:=(new.data->>'resource')::uuid;
  elsif review is not null then
   if review->'equipment'='null'::jsonb then is_present:=false;selected:=prior.resource_id;
   else selected:=(review->'equipment'->>'resourceId')::uuid;end if;
  else selected:=prior.resource_id;is_present:=coalesce(prior.present,false);
  end if;
  if selected is null then continue;end if;
  select * into resource from lms.records where organization_id=new.organization_id and id=selected and entity='resources';
  m:=null;machine:=null;
  if resource.data->>'kind'='Equipment' and is_present then
   select * into m from lms.equipment_resource_mappings h where h.organization_id=new.organization_id and h.resource_id=selected and h.active;
   if not is_blocking then
    select * into row_data from lms.appointment_resource_allocations where organization_id=new.organization_id and appointment_id=new.id and slot=slot_name;
    if row_data.equipment_id is not null then select * into m from lms.equipment_mapping_history h where h.organization_id=new.organization_id and h.equipment_id=row_data.equipment_id and h.revision=row_data.mapping_revision;end if;
   end if;
   select * into machine from lms.records where organization_id=new.organization_id and id=m.equipment_id;
  elsif slot_name='Equipment' and not is_present then
   select * into m from lms.equipment_mapping_history h where h.organization_id=new.organization_id and h.equipment_id=prior.equipment_id and h.revision=prior.mapping_revision;
   select * into machine from lms.records where organization_id=new.organization_id and id=prior.equipment_id;
  end if;
  origin:=case when review is not null then 'Reviewed' when prior.present and not is_blocking then 'Retained release' else 'Single resource' end;
  insert into lms.appointment_resource_allocations values(new.organization_id,new.id,slot_name,new.revision,new.config_revision,resource.id,resource.revision,resource.data->>'name',resource.data->>'kind',
   machine.id,case when machine.id is not null then machine.revision end,m.revision,machine.data->>'asset_id',(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,is_blocking and is_present,is_present,lms.current_user_id(),(command->>'operationId')::uuid,origin,now())
  on conflict(organization_id,appointment_id,slot) do update set appointment_revision=excluded.appointment_revision,config_revision=excluded.config_revision,resource_id=excluded.resource_id,resource_revision=excluded.resource_revision,resource_name=excluded.resource_name,resource_kind=excluded.resource_kind,equipment_id=excluded.equipment_id,equipment_revision=excluded.equipment_revision,mapping_revision=excluded.mapping_revision,equipment_asset_id=excluded.equipment_asset_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,blocking=excluded.blocking,present=excluded.present,recorded_by=excluded.recorded_by,operation_id=excluded.operation_id,origin=excluded.origin,recorded_at=excluded.recorded_at;
  insert into lms.appointment_allocation_history select * from lms.appointment_resource_allocations where organization_id=new.organization_id and appointment_id=new.id and slot=slot_name;
  if machine.id is not null and is_present then insert into lms.equipment_reservations values(new.organization_id,new.id,new.revision,machine.id,resource.id,m.revision,machine.revision,resource.revision,(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,is_blocking);end if;
 end loop;
 if review is not null then
  insert into lms.audit_events(organization_id,actor_id,entity,record_id,action,before_data,after_data)
  values(new.organization_id,lms.current_user_id(),'appointment-resources',new.id,'review',null,jsonb_build_object('appointmentRevision',new.revision,'review',review));
 end if;
 if exists(select 1 from lms.appointment_resource_allocations where organization_id=new.organization_id and appointment_id=new.id and slot='Equipment' and present) then
  insert into lms.record_links values(new.organization_id,new.id,'@equipment-resource',(select resource_id from lms.appointment_resource_allocations where organization_id=new.organization_id and appointment_id=new.id and slot='Equipment'),'resources');
 end if;
 return new;
end; $$;
-- Resource exclusion runs after the appointment projection and before workforce allocations.
create trigger record_scheduling_allocations_projection after insert or update on lms.records for each row execute function lms_private.coordinated_projection();
create function lms_private.additional_availability_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare a lms.appointment_resource_allocations;
begin
 if new.entity='availability' then
  for a in select * from lms.appointment_resource_allocations where organization_id=new.organization_id and slot='Equipment' and present and blocking loop
   perform lms_private.assert_subject_available(new.organization_id,null,a.resource_id,a.starts_at,a.ends_at,false);
  end loop;
 end if;
 return new;
end; $$;
create trigger record_zz_additional_availability_guard after insert or update on lms.records for each row execute function lms_private.additional_availability_guard();
revoke all on function lms_private.allocation_history_guard(),lms_private.equipment_booking(uuid,uuid,timestamptz,boolean),lms_private.coordinated_guard(),lms_private.mapping_allocation_guard(),lms_private.coordinated_projection(),lms_private.additional_availability_guard() from public,lms_app;
