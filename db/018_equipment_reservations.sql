-- Additive, explicit calendar enrollment; never infer a physical machine from a name.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before equipment reservation migration' using errcode='55000';end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
create table lms.equipment_resource_mappings (
 organization_id uuid not null references lms.organizations(id), equipment_id uuid not null, resource_id uuid not null,
 revision integer not null check(revision>0),equipment_revision integer not null check(equipment_revision>0),resource_revision integer not null check(resource_revision>0),
 config_revision integer not null,active boolean not null,actor_id uuid not null references lms.users(id),operation_id uuid not null,occurred_at timestamptz not null default now(),
 primary key(organization_id,equipment_id),
 foreign key(organization_id,equipment_id) references lms.equipment_state(organization_id,record_id),
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision),
 unique(organization_id,operation_id)
);
create unique index one_active_equipment_resource on lms.equipment_resource_mappings(organization_id,resource_id) where(active);
create table lms.equipment_mapping_history (like lms.equipment_resource_mappings including defaults including constraints);
alter table lms.equipment_mapping_history add primary key(organization_id,equipment_id,revision),
 add unique(organization_id,operation_id),
 add foreign key(organization_id,equipment_id) references lms.equipment_state(organization_id,record_id),
 add foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 add foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision),
 add foreign key(actor_id) references lms.users(id);
create index equipment_mapping_resource_history on lms.equipment_mapping_history(organization_id,resource_id,equipment_id);
create table lms.equipment_reservations (
 organization_id uuid not null, appointment_id uuid not null, appointment_revision integer not null,
 equipment_id uuid not null, resource_id uuid not null,mapping_revision integer not null,
 equipment_revision integer not null,resource_revision integer not null,starts_at timestamptz not null,ends_at timestamptz not null,blocking boolean not null,
 primary key(organization_id,appointment_id,appointment_revision),
 foreign key(organization_id,appointment_id) references lms.records(organization_id,id),
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 foreign key(organization_id,equipment_id,mapping_revision) references lms.equipment_mapping_history(organization_id,equipment_id,revision)
);
create index equipment_reservations_equipment on lms.equipment_reservations(organization_id,equipment_id,starts_at);
alter table lms.equipment_resource_mappings enable row level security;
alter table lms.equipment_resource_mappings force row level security;
alter table lms.equipment_mapping_history enable row level security;
alter table lms.equipment_mapping_history force row level security;
alter table lms.equipment_reservations enable row level security;
alter table lms.equipment_reservations force row level security;
revoke all on lms.equipment_resource_mappings,lms.equipment_mapping_history,lms.equipment_reservations from public,lms_app;
grant select on lms.equipment_resource_mappings,lms.equipment_mapping_history,lms.equipment_reservations to lms_app;
create policy read_equipment_mappings on lms.equipment_resource_mappings for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_equipment_mapping_history on lms.equipment_mapping_history for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_equipment_reservations on lms.equipment_reservations for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create trigger equipment_mapping_history_immutable before update or delete on lms.equipment_mapping_history for each row execute function lms_private.equipment_history_guard();
create trigger equipment_mapping_retained before delete on lms.equipment_resource_mappings for each row execute function lms_private.equipment_history_guard();
create trigger equipment_reservations_immutable before update or delete on lms.equipment_reservations for each row execute function lms_private.equipment_history_guard();

create function lms.write_equipment_mapping(org uuid,operation uuid,req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt lms.record_operations;prior lms.equipment_resource_mappings;result lms.equipment_resource_mappings;eq lms.records;res lms.records;cfg lms.config_revisions;state lms.equipment_state;
begin
 if operation is null then raise exception 'Mapping requires an operation ID' using errcode='23514';end if;
 perform 1 from lms.organizations where id=org for update;
 perform lms_private.equipment_operator(org,'mapping');
 insert into lms_private.record_epochs values(org,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 select * into receipt from lms.record_operations where organization_id=org and operation_id=operation;
 if found then
  if receipt.actor_id is distinct from lms.current_user_id() or receipt.request is distinct from jsonb_build_object('kind','equipment-mapping','input',req) then raise exception 'Operation ID already describes a different request' using errcode='23514';end if;
  return receipt.result;
 end if;
 if jsonb_typeof(req) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(req) k) is distinct from array['acknowledgement','configRevision','equipmentId','equipmentRevision','kind','mappingRevision','notes','resourceId','resourceRevision']::text[]
 or req->>'kind' not in ('map','unmap') or req->>'acknowledgement' is distinct from 'CONFIRM FICTIONAL EQUIPMENT MAPPING' or jsonb_typeof(req->'notes') is distinct from 'string' or length(btrim(req->>'notes')) not between 8 and 1000 then raise exception 'Review and explicitly confirm the supported equipment mapping' using errcode='23514';end if;
 if jsonb_typeof(req->'equipmentId') is distinct from 'string' or jsonb_typeof(req->'resourceId') is distinct from 'string'
 or exists(select 1 from unnest(array['equipmentRevision','resourceRevision','configRevision']) k where jsonb_typeof(req->k) is distinct from 'number' or (req->>k) !~ '^[1-9][0-9]*$')
 or jsonb_typeof(req->'mappingRevision') is distinct from 'number' or (req->>'mappingRevision') !~ '^(0|[1-9][0-9]*)$' then raise exception 'Mapping IDs and exact integer revisions require reviewed types' using errcode='23514';end if;
 select * into cfg from lms.config_revisions where organization_id=org order by revision desc limit 1;
 if cfg.revision is distinct from (req->>'configRevision')::integer or not exists(select 1 from jsonb_array_elements(cfg.document->'modules') m where m->>'id'='equipment-reservations' and m->>'version'='1.0.0') then raise exception 'Reservation configuration changed or capability is disabled; review again' using errcode='23514';end if;
 eq:=lms_private.equipment_reference(org,(req->>'equipmentId')::uuid,(req->>'equipmentRevision')::integer,array['equipment']);
 res:=lms_private.equipment_reference(org,(req->>'resourceId')::uuid,(req->>'resourceRevision')::integer,array['resources']);
 select * into state from lms.equipment_state where organization_id=org and record_id=eq.id;
 if state.record_id is null or state.revision<>eq.revision or state.condition='Retired' or res.data->>'kind' is distinct from 'Equipment' then raise exception 'Review a retained non-retired machine and an Equipment calendar resource' using errcode='23514';end if;
 select * into prior from lms.equipment_resource_mappings where organization_id=org and equipment_id=eq.id;
 if coalesce(prior.revision,0) is distinct from (req->>'mappingRevision')::integer then raise exception 'Equipment mapping changed; reload its exact revision' using errcode='23514';end if;
 if req->>'kind'='unmap' and (prior.active is distinct from true or prior.resource_id is distinct from res.id) then raise exception 'Review the current active mapping before unmapping' using errcode='23514';end if;
 if req->>'kind'='map' and prior.active then raise exception 'Explicitly unmap the retained association before mapping again' using errcode='23514';end if;
 -- Permanent resource enrollment prevents legacy names or remapping a resource to another physical machine.
 if exists(select 1 from lms.equipment_mapping_history where organization_id=org and resource_id=res.id and equipment_id<>eq.id) then raise exception 'A previously enrolled resource retains its physical equipment identity; create a new resource' using errcode='23514';end if;
 if exists(select 1 from lms.equipment_resource_mappings where organization_id=org and resource_id=res.id and active and equipment_id<>eq.id) then raise exception 'Resource already maps to another equipment item' using errcode='23514';end if;
 if exists(select 1 from lms.appointments a where a.organization_id=org and a.blocking and (a.resource_id=res.id or a.resource_id=prior.resource_id or a.resource_id in(select h.resource_id from lms.equipment_mapping_history h where h.organization_id=org and h.equipment_id=eq.id))) or exists(select 1 from lms.equipment_checkouts where organization_id=org and equipment_id=eq.id and returned_at is null) then raise exception 'Retained blocking reservations or physical custody prevent mapping changes; review them separately' using errcode='23514';end if;
 insert into lms.equipment_resource_mappings values(org,eq.id,res.id,coalesce(prior.revision,0)+1,eq.revision,res.revision,cfg.revision,req->>'kind'='map',lms.current_user_id(),operation,now())
 on conflict(organization_id,equipment_id) do update set resource_id=excluded.resource_id,revision=excluded.revision,equipment_revision=excluded.equipment_revision,resource_revision=excluded.resource_revision,config_revision=excluded.config_revision,active=excluded.active,actor_id=excluded.actor_id,operation_id=excluded.operation_id,occurred_at=excluded.occurred_at returning * into result;
 insert into lms.equipment_mapping_history select result.*;
 insert into lms.record_operations values(org,operation,lms.current_user_id(),eq.id,jsonb_build_object('kind','equipment-mapping','input',req),to_jsonb(result));
 insert into lms.audit_events(organization_id,actor_id,entity,record_id,action,before_data,after_data) values(org,lms.current_user_id(),'equipment-resource-mapping',eq.id,req->>'kind',case when prior.equipment_id is null then null else to_jsonb(prior) end,jsonb_build_object('mapping',to_jsonb(result),'reason',btrim(req->>'notes')));
 return to_jsonb(result);
end; $$;
revoke all on function lms.write_equipment_mapping(uuid,uuid,jsonb) from public;
grant execute on function lms.write_equipment_mapping(uuid,uuid,jsonb) to lms_app;

create function lms_private.equipment_reservation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare m lms.equipment_resource_mappings;s lms.equipment_state;cfg jsonb;resource lms.records;machine lms.records;enrolled boolean;
begin
 perform 1 from lms.organizations where id=new.organization_id for update;
 begin
  perform lms_private.equipment_operator(new.organization_id,'checkout');
 exception when insufficient_privilege then
  raise exception 'Record violates row-level security' using errcode='42501';
 end;
 insert into lms_private.record_epochs values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 -- Uniform lock order also covers raw workforce/availability writers before their existing epoch guard.
 if new.entity not in ('appointments','resources','equipment') then return new;end if;
 if new.entity='resources' then
  if exists(select 1 from lms.equipment_mapping_history where organization_id=new.organization_id and resource_id=new.id) and new.data->>'kind' is distinct from 'Equipment' then raise exception 'An enrolled Equipment resource retains its physical type' using errcode='23514';end if;
  if new.archived and exists(select 1 from lms.equipment_resource_mappings where organization_id=new.organization_id and resource_id=new.id and active) then raise exception 'Explicitly unmap equipment before archiving its resource' using errcode='23514';end if;
  return new;
 end if;
 -- Safety reports, maintenance and physical custody are never prevented by future appointments.
 if new.entity='equipment' then return new;end if;
 if new.archived or new.data->>'status'='Cancelled' then return new;end if;
 select document into cfg from lms.config_revisions where organization_id=new.organization_id order by revision desc limit 1;
 select * into resource from lms.records where organization_id=new.organization_id and id=(new.data->>'resource')::uuid and entity='resources';
 enrolled:=exists(select 1 from lms.equipment_mapping_history where organization_id=new.organization_id and resource_id=resource.id);
 if not enrolled and not (resource.data->>'kind'='Equipment' and exists(select 1 from jsonb_array_elements(cfg->'modules') v where v->>'id'='equipment-reservations')) then return new;end if;
 select * into m from lms.equipment_resource_mappings where organization_id=new.organization_id and resource_id=resource.id and active;
 select * into s from lms.equipment_state where organization_id=new.organization_id and record_id=m.equipment_id;
 select * into machine from lms.records where organization_id=new.organization_id and id=m.equipment_id;
 if not exists(select 1 from jsonb_array_elements(cfg->'modules') v where v->>'id'='equipment-reservations') or m.equipment_id is null or machine.archived or s.revision is distinct from machine.revision or s.condition is distinct from 'Serviceable' or s.maintenance is distinct from 'Clear' then raise exception 'Equipment is unmapped, disabled or unsafe; review the physical machine before reserving' using errcode='23514';end if;
 if exists(select 1 from lms.equipment_checkouts where organization_id=new.organization_id and equipment_id=m.equipment_id and returned_at is null) then raise exception 'Equipment is currently checked out; a future return is not a collection guarantee' using errcode='23514';end if;
 if s.next_inspection is not null and (((new.data->>'end')::timestamptz-interval '1 microsecond') at time zone coalesce(cfg->>'timeZone','UTC'))::date>=s.next_inspection then raise exception 'Equipment inspection is due before this reservation completes; review service first' using errcode='23514';end if;
 return new;
end; $$;
-- Runs after the immutable identity guard, before relationship/workforce epoch guards.
-- The earlier equipment guard already uses this organization-first order.
create trigger record_gz_equipment_reservation_guard before insert or update on lms.records for each row execute function lms_private.equipment_reservation_guard();
create function lms_private.equipment_reservation_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare m lms.equipment_resource_mappings;previous lms.equipment_reservations;eq_revision integer;resource_revision integer;
begin
 if new.entity<>'appointments' then return new;end if;
 if new.archived or new.data->>'status'='Cancelled' then
  select * into previous from lms.equipment_reservations where organization_id=new.organization_id and appointment_id=new.id order by appointment_revision desc limit 1;
  if previous.appointment_id is null then return new;end if;
  insert into lms.equipment_reservations values(new.organization_id,new.id,new.revision,previous.equipment_id,previous.resource_id,previous.mapping_revision,previous.equipment_revision,previous.resource_revision,(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,false);
 else
  select * into m from lms.equipment_resource_mappings where organization_id=new.organization_id and resource_id=(new.data->>'resource')::uuid and active;
  if m.equipment_id is null then return new;end if;
  select revision into eq_revision from lms.records where organization_id=new.organization_id and id=m.equipment_id;
  select revision into resource_revision from lms.records where organization_id=new.organization_id and id=m.resource_id;
  insert into lms.equipment_reservations values(new.organization_id,new.id,new.revision,m.equipment_id,m.resource_id,m.revision,eq_revision,resource_revision,(new.data->>'start')::timestamptz,(new.data->>'end')::timestamptz,true);
 end if;
 return new;
end; $$;
create trigger record_equipment_reservation_projection after insert or update on lms.records for each row execute function lms_private.equipment_reservation_projection();
revoke all on function lms_private.equipment_reservation_guard(),lms_private.equipment_reservation_projection() from public,lms_app;

-- Configuration publication/rollback uses the same order, including direct SQL writers.
create function lms_private.equipment_reservation_config_lock() returns trigger language plpgsql security definer set search_path='' as $$
begin perform 1 from lms.organizations where id=new.organization_id for update;return new;end; $$;
create trigger config_aa_equipment_reservation_lock before insert on lms.config_revisions for each row execute function lms_private.equipment_reservation_config_lock();
revoke all on function lms_private.equipment_reservation_config_lock() from public,lms_app;

-- Preserve the reviewed estimate materializer verbatim, behind an organization-first entry point.
-- Its original epoch-first public entry otherwise inverts raw catalog writers' lock order.
alter function lms.prepare_estimate(uuid,jsonb,uuid,integer) rename to prepare_estimate_snapshot;
alter function lms.prepare_estimate_snapshot(uuid,jsonb,uuid,integer) set schema lms_private;
revoke all on function lms_private.prepare_estimate_snapshot(uuid,jsonb,uuid,integer) from public,lms_app;
create function lms.prepare_estimate(org uuid,input_data jsonb,prior_id uuid default null,expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from lms.organizations where id=org for update;
 return lms_private.prepare_estimate_snapshot(org,input_data,prior_id,expected_revision);
end; $$;
revoke all on function lms.prepare_estimate(uuid,jsonb,uuid,integer) from public;
grant execute on function lms.prepare_estimate(uuid,jsonb,uuid,integer) to lms_app;
create trigger build_plan_aa_equipment_reservation_lock before insert on lms.build_plan_revisions for each row execute function lms_private.equipment_reservation_config_lock();
