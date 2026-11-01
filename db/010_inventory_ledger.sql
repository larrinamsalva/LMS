-- Additive inventory ledger. Applied migrations 1-9 and saved catalog/config history stay unchanged.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before inventory migration' using errcode='55000'; end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
do $$ begin if exists(select 1 from lms.records where entity in ('stock-locations','stock-movements')) then raise exception 'Untracked stock records require a reviewed migration'; end if; end; $$;
create unique index inventory_sku on lms.records(organization_id,lower(data->>'sku')) where entity='items' and coalesce(data->>'sku','')<>'';
create unique index inventory_barcode on lms.records(organization_id,(data->>'barcode')) where entity='items' and coalesce(data->>'barcode','')<>'';
create table lms.stock_balances (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 product_id uuid not null, location_id uuid not null, units bigint not null check(units between 0 and 999999999999),
 primary key(organization_id,product_id,location_id),
 foreign key(organization_id,product_id) references lms.records(organization_id,id),
 foreign key(organization_id,location_id) references lms.records(organization_id,id)
);
create index stock_balances_location on lms.stock_balances(organization_id,location_id,product_id);
create table lms.stock_movements (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 record_id uuid not null, operation_id uuid not null, actor_id uuid not null references lms.users(id), actor_name text not null,
 action text not null check(action in ('Receiving','Usage','Transfer','Return','Adjustment increase','Adjustment decrease')),
 product_id uuid not null, location_id uuid not null, destination_id uuid, work_id uuid, correction_id uuid,
 quantity bigint not null check(quantity between 1 and 999999999999), packaging text not null check(packaging in ('Units','Cases')),
 case_size bigint not null check(case_size between 1 and 1000000), units bigint not null check(units between 1 and 999999999999),
 product_revision integer not null check(product_revision>0), product_name text not null, unit text not null, sku text not null, barcode text not null,
 location_name text not null, destination_name text not null, work_title text not null, reason text not null,
 occurred_on date not null check(occurred_on between date '2020-01-01' and date '2100-12-31'), recorded_at timestamptz not null default now(),
 primary key(organization_id,record_id), unique(organization_id,operation_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id),
 foreign key(organization_id,product_id) references lms.records(organization_id,id),
 foreign key(organization_id,location_id) references lms.records(organization_id,id),
 foreign key(organization_id,destination_id) references lms.records(organization_id,id),
 foreign key(organization_id,work_id) references lms.records(organization_id,id),
 foreign key(organization_id,correction_id) references lms.stock_movements(organization_id,record_id),
 check((action='Transfer' and destination_id is not null and destination_id<>location_id) or (action<>'Transfer' and destination_id is null)),
 check(units=quantity*case when packaging='Cases' then case_size else 1 end)
);
create index stock_movements_product on lms.stock_movements(organization_id,product_id,recorded_at,record_id);
create index stock_movements_location on lms.stock_movements(organization_id,location_id,recorded_at,record_id);
alter table lms.stock_balances enable row level security;
alter table lms.stock_balances force row level security;
alter table lms.stock_movements enable row level security;
alter table lms.stock_movements force row level security;
create policy read_stock_balances on lms.stock_balances for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_stock_movements on lms.stock_movements for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
revoke all on lms.stock_balances,lms.stock_movements from public,lms_app;
grant select on lms.stock_balances,lms.stock_movements to lms_app;

create function lms_private.stock_integer(value jsonb, positive boolean default false) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^(0|[1-9][0-9]{0,11})$' then raise exception 'Stock quantities must be canonical whole-unit strings' using errcode='23514'; end if;
 if positive and (value#>>'{}')::bigint=0 then raise exception 'Stock quantity must be positive' using errcode='23514'; end if;
 return (value#>>'{}')::bigint;
end; $$;
-- This runs AFTER record_relationship_guard has advanced the existing organization epoch.
-- The epoch orders stock commands, catalog/archive changes and raw SQL writers, including RR snapshots.
create function lms_private.inventory_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare product lms.records; place lms.records; destination lms.records; work lms.records; definition jsonb; config jsonb; quantity bigint; size bigint; spec jsonb; command jsonb;
begin
 if tg_op<>'INSERT' and old.entity='stock-movements' then raise exception 'Stock ledger is immutable; post an authorized compensating movement' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.entity not in ('items','stock-locations','stock-movements') then return new; end if;
 select document into config from lms.config_revisions where organization_id=new.organization_id order by revision desc limit 1;
 select e into definition from jsonb_array_elements(config->'entities')e where e->>'id'=new.entity;
 if definition->>'module' is distinct from 'inventory' then raise exception 'Inventory requires its reviewed module contract' using errcode='23514'; end if;
 if exists(select 1 from jsonb_object_keys(new.data)k where not exists(select 1 from jsonb_array_elements(definition->'fields')f where f->>'key'=k)) then raise exception 'Unsupported inventory field' using errcode='23514'; end if;
 for spec in select f from jsonb_array_elements(definition->'fields')f where f->>'type' not in ('reference','number') loop
  if new.data ? (spec->>'key') and jsonb_typeof(new.data->(spec->>'key'))<>'string' then raise exception 'Inventory fields require strings' using errcode='23514'; end if;
 end loop;
 if new.entity in ('items','stock-locations') then
  if not lms.has_role(new.organization_id,array['owner','admin']) then raise exception 'Inventory catalog management requires owner/admin' using errcode='42501'; end if;
  if coalesce(btrim(new.data->>'name'),'')='' or length(new.data->>'name')>200 then raise exception 'Inventory name is required' using errcode='23514'; end if;
  if new.entity='items' then
   if exists(select 1 from jsonb_each(new.data) f where f.key in ('sku','barcode','unit','category','notes') and jsonb_typeof(f.value)<>'string') then raise exception 'Product metadata requires text' using errcode='23514'; end if;
   if nullif(new.data->>'case_size','') is not null then size:=lms_private.stock_integer(new.data->'case_size',true); if size>1000000 then raise exception 'Case size exceeds 1000000' using errcode='23514';end if; end if;
   if nullif(new.data->>'minimum','') is not null then perform lms_private.stock_integer(new.data->'minimum'); end if;
   if tg_op='UPDATE' and coalesce(new.data->>'unit','') is distinct from coalesce(old.data->>'unit','') and exists(select 1 from lms.stock_movements where organization_id=new.organization_id and product_id=new.id) then raise exception 'A stocked product retains its unit; create a different product' using errcode='23514'; end if;
   if (new.data ? 'sku' and coalesce(new.data->>'sku','')<>btrim(new.data->>'sku')) or (new.data ? 'barcode' and coalesce(new.data->>'barcode','')<>btrim(new.data->>'barcode')) then raise exception 'Trim SKU/barcode whitespace' using errcode='23514'; end if;
  end if;
  return new;
 end if;
 if new.archived or new.data->>'action' is null or new.data->>'action' not in ('Receiving','Usage','Transfer','Return','Adjustment increase','Adjustment decrease') then raise exception 'Use an active supported stock movement' using errcode='23514'; end if;
 if new.data->>'action' like 'Adjustment%' or nullif(new.data->>'correction','') is not null then
  if not lms.has_role(new.organization_id,array['owner','admin']) then raise exception 'Stock adjustments/corrections require owner/admin' using errcode='42501'; end if;
 end if;
 if coalesce(btrim(new.data->>'title'),'')='' or length(new.data->>'title')>200 or coalesce(btrim(new.data->>'reason'),'')='' or length(new.data->>'reason')>2000 then raise exception 'Movement title and reason are required' using errcode='23514'; end if;
 command:=nullif(current_setting('lms.record_command',true),'')::jsonb;
 if command is null or nullif(command->>'operationId','') is null then raise exception 'Stock movements require an operation receipt' using errcode='23514'; end if;
 select * into product from lms.records where organization_id=new.organization_id and id=(new.data->>'product')::uuid and entity='items' and not archived;
 select * into place from lms.records where organization_id=new.organization_id and id=(new.data->>'location')::uuid and entity='stock-locations' and not archived;
 if product.id is null or place.id is null then raise exception 'Use an active product and storage location in this organization' using errcode='23514'; end if;
 if jsonb_typeof(new.data->'product_revision') is distinct from 'number' or coalesce(new.data->>'product_revision','') !~ '^[1-9][0-9]{0,8}$' or (new.data->>'product_revision')::integer<>product.revision then raise exception 'Product changed; reload and review its packaging before posting' using errcode='23514'; end if;
 quantity:=lms_private.stock_integer(new.data->'quantity',true);
 size:=case when nullif(product.data->>'case_size','') is null then 1 else lms_private.stock_integer(product.data->'case_size',true) end;
 if size>1000000 or coalesce(new.data->>'package','') not in ('Units','Cases') or quantity*(case when new.data->>'package'='Cases' then size else 1 end)>999999999999 then raise exception 'Invalid packaging or converted quantity exceeds limit' using errcode='23514'; end if;
 if new.data->>'action'='Transfer' then
  select * into destination from lms.records where organization_id=new.organization_id and id=(new.data->>'destination')::uuid and entity='stock-locations' and not archived;
  if destination.id is null or destination.id=place.id then raise exception 'Transfer requires a different active location in this organization' using errcode='23514'; end if;
 elsif nullif(new.data->>'destination','') is not null then raise exception 'Only transfers have a destination' using errcode='23514'; end if;
 if nullif(new.data->>'work','') is not null then
  select * into work from lms.records where organization_id=new.organization_id and id=(new.data->>'work')::uuid and not archived;
  if work.id is null or work.entity not in ('tasks','jobs') or not exists(select 1 from jsonb_array_elements(definition->'fields')f where f->>'key'='work' and f->>'type'='reference' and f->>'target'=work.entity) then raise exception 'Movement work link is unavailable' using errcode='23514'; end if;
 end if;
 if nullif(new.data->>'correction','') is not null and not exists(select 1 from lms.stock_movements where organization_id=new.organization_id and record_id=(new.data->>'correction')::uuid and product_id=product.id) then raise exception 'Correction must link prior history for this product' using errcode='23514'; end if;
 if coalesce(new.data->>'occurred_on','') !~ '^\d{4}-\d{2}-\d{2}$' or (new.data->>'occurred_on')::date not between date '2020-01-01' and date '2100-12-31' or to_char((new.data->>'occurred_on')::date,'YYYY-MM-DD')<>new.data->>'occurred_on' then raise exception 'Use a real movement date from 2020 to 2100' using errcode='23514'; end if;
 return new;
end; $$;
create trigger record_stock_guard before insert or update or delete on lms.records for each row execute function lms_private.inventory_guard();

create function lms_private.stock_delta(org uuid,product uuid,place uuid,delta bigint) returns void language plpgsql security definer set search_path='' as $$
declare balance bigint;
begin
 select units into balance from lms.stock_balances where organization_id=org and product_id=product and location_id=place;
 if coalesce(balance,0)+delta not between 0 and 999999999999 then raise exception 'Insufficient stock or stock limit exceeded at this location' using errcode='23514'; end if;
 insert into lms.stock_balances values(org,product,place,coalesce(balance,0)+delta)
 on conflict(organization_id,product_id,location_id) do update set units=excluded.units;
end; $$;
create function lms_private.inventory_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare product lms.records; place lms.records; destination lms.records; work lms.records; qty bigint; size bigint; base bigint; delta bigint;
begin
 if new.entity<>'stock-movements' then return new; end if;
 select * into product from lms.records where organization_id=new.organization_id and id=(new.data->>'product')::uuid;
 select * into place from lms.records where organization_id=new.organization_id and id=(new.data->>'location')::uuid;
 select * into destination from lms.records where organization_id=new.organization_id and id=nullif(new.data->>'destination','')::uuid;
 select * into work from lms.records where organization_id=new.organization_id and id=nullif(new.data->>'work','')::uuid;
 qty:=(new.data->>'quantity')::bigint; size:=coalesce(nullif(product.data->>'case_size',''),'1')::bigint;
 base:=qty*case when new.data->>'package'='Cases' then size else 1 end;
 delta:=case when new.data->>'action' in ('Usage','Transfer','Adjustment decrease') then -base else base end;
 perform lms_private.stock_delta(new.organization_id,product.id,place.id,delta);
 if destination.id is not null then perform lms_private.stock_delta(new.organization_id,product.id,destination.id,base); end if;
 insert into lms.stock_movements(organization_id,record_id,operation_id,actor_id,actor_name,action,product_id,location_id,destination_id,work_id,correction_id,quantity,packaging,case_size,units,product_revision,product_name,unit,sku,barcode,location_name,destination_name,work_title,reason,occurred_on)
 values(new.organization_id,new.id,(nullif(current_setting('lms.record_command',true),'')::jsonb->>'operationId')::uuid,lms.current_user_id(),coalesce((select display_name from lms.users where id=lms.current_user_id()),'Authorized user'),new.data->>'action',product.id,place.id,destination.id,work.id,nullif(new.data->>'correction','')::uuid,qty,new.data->>'package',size,base,product.revision,product.data->>'name',coalesce(nullif(product.data->>'unit',''),'unit'),coalesce(product.data->>'sku',''),coalesce(product.data->>'barcode',''),place.data->>'name',coalesce(destination.data->>'name',''),coalesce(work.data->>'title',''),new.data->>'reason',(new.data->>'occurred_on')::date);
 return new;
end; $$;
create trigger record_stock_projection after insert on lms.records for each row execute function lms_private.inventory_projection();
revoke all on function lms_private.stock_integer(jsonb,boolean),lms_private.inventory_guard(),lms_private.stock_delta(uuid,uuid,uuid,bigint),lms_private.inventory_projection() from public,lms_app;

-- Immutable movements are historical inbound links; catalog archival never erases them or balances.
create or replace function lms_private.relationship_guard() returns trigger language plpgsql security definer set search_path='' as $$
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
  if new.archived and not old.archived and exists(select 1 from lms.record_links l join lms.records r on r.organization_id=l.organization_id and r.id=l.source_id where l.organization_id=new.organization_id and l.target_id=new.id and r.id<>new.id and not r.archived and r.entity<>'stock-movements') then raise exception 'Archive linked active records first; history is retained' using errcode='23514'; end if;
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
