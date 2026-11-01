-- Draft artifacts are separate from operational records and published configuration revisions.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before BuildPlan migration' using errcode='55000';end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
create table lms.build_plan_revisions (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 id uuid not null, revision integer not null check(revision between 1 and 20),
 base_revision integer not null, entity text not null default 'build-plan' check(entity='build-plan'),
 document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=65536),
 created_by uuid not null references lms.users(id), created_at timestamptz not null default now(),
 primary key(organization_id,id,revision),
 foreign key(organization_id,base_revision) references lms.config_revisions(organization_id,revision)
);
alter table lms.build_plan_revisions enable row level security;
alter table lms.build_plan_revisions force row level security;
create policy read_build_plans on lms.build_plan_revisions for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
create policy save_build_plans on lms.build_plan_revisions for insert to lms_app with check(lms.has_role(organization_id,array['owner','admin']) and created_by=lms.current_user_id());
revoke all on lms.build_plan_revisions from public,lms_app;
grant select,insert on lms.build_plan_revisions to lms_app;
create function lms_private.build_plan_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare prior integer;
begin
 if not lms.has_role(new.organization_id,array['owner','admin']) or new.created_by is distinct from lms.current_user_id() then raise exception 'BuildPlan drafts require owner/admin' using errcode='42501';end if;
 insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 if new.document->>'format' is distinct from 'lms-build-plan' or new.document->'version' is distinct from '1'::jsonb or new.document->'engineApi' is distinct from '1'::jsonb or new.document->'templateVersion' is distinct from '1'::jsonb or coalesce(new.document->>'template','') not in ('property','cleaning','custom') or jsonb_typeof(new.document->'configuration') is distinct from 'object' or new.document->'configuration'->'schemaVersion' is distinct from '1'::jsonb or exists(select 1 from jsonb_object_keys(new.document)k where k not in ('format','version','engineApi','templateVersion','template','configuration')) then raise exception 'Unsupported BuildPlan envelope' using errcode='23514';end if;
 select max(revision) into prior from lms.build_plan_revisions where organization_id=new.organization_id and id=new.id;
 if new.revision<>coalesce(prior,0)+1 then raise exception 'BuildPlan changed; reload before saving' using errcode='23514';end if;
 if prior is null and (select count(distinct id) from lms.build_plan_revisions where organization_id=new.organization_id)>=5 then raise exception 'Temporary workspace supports five BuildPlans' using errcode='23514';end if;
 new.created_at:=now();
 return new;
end; $$;
revoke all on function lms_private.build_plan_guard() from public,lms_app;
create trigger build_plan_guard before insert on lms.build_plan_revisions for each row execute function lms_private.build_plan_guard();
create trigger build_plan_audit after insert on lms.build_plan_revisions for each row execute function lms_private.audit_change();
-- The fictional PGlite demo has no identity/control schema; native databases reuse its online write gate.
do $$ begin if to_regprocedure('lms_control.runtime_write_guard()') is not null then
 execute 'create trigger runtime_build_plan_guard before insert on lms.build_plan_revisions for each row execute function lms_control.runtime_write_guard()';
end if;end; $$;

-- Preserve expiry cleanup of isolated fictional organizations without allowing ledger-row deletion.
create or replace function lms_private.inventory_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare product lms.records; place lms.records; destination lms.records; work lms.records; definition jsonb; config jsonb; quantity bigint; size bigint; spec jsonb; command jsonb;
begin
 -- Only parent-organization deletion by the trusted host can retire an entire temporary sandbox.
 -- Runtime cannot delete organizations; direct source-row deletion still refuses.
 if tg_op='DELETE' and not exists(select 1 from lms.organizations where id=old.organization_id) then return old;end if;
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
