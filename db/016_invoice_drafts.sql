-- Optional fictional invoice drafts. No issuance, payment, messaging or activation capability.
-- All earlier migrations and checksums are unchanged. Stop runtime hosts first.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before invoice draft migration' using errcode='55000'; end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
do $$ begin
 if exists(select 1 from lms.records where entity='invoice-drafts') then raise exception 'Untracked invoice drafts require separate review'; end if;
end; $$;
create table lms.invoice_origins (
 organization_id uuid not null references lms.organizations(id),
 record_id uuid not null, estimate_id uuid not null, estimate_revision integer not null,
 primary key(organization_id,record_id), unique(organization_id,estimate_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id),
 foreign key(organization_id,estimate_id,estimate_revision) references lms.estimate_versions(organization_id,record_id,revision)
);
create table lms.invoice_versions (
 organization_id uuid not null references lms.organizations(id), record_id uuid not null,
 revision integer not null check(revision>0),config_revision integer not null,
 data jsonb not null, actor_id uuid not null references lms.users(id), operation_id uuid not null,
 occurred_at timestamptz not null default now(),
 primary key(organization_id,record_id,revision),unique(organization_id,operation_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id),
 foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision)
);
alter table lms.invoice_origins enable row level security;
alter table lms.invoice_origins force row level security;
alter table lms.invoice_versions enable row level security;
alter table lms.invoice_versions force row level security;
revoke all on lms.invoice_origins,lms.invoice_versions from public,lms_app;
grant select on lms.invoice_origins,lms.invoice_versions to lms_app;
create policy read_invoice_origins on lms.invoice_origins for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_invoice_versions on lms.invoice_versions for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create function lms_private.invoice_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Financial snapshots and source bindings are append-only' using errcode='23514'; end; $$;
create trigger invoice_origin_immutable before update or delete on lms.invoice_origins for each row execute function lms_private.invoice_immutable();
create trigger invoice_version_immutable before update or delete on lms.invoice_versions for each row execute function lms_private.invoice_immutable();

-- One authoritative derivation, shared by the command and raw-write guard. Existing exact
-- estimate selection, quantity, rounding, bounds, snapshots and extra rules remain authoritative.
create function lms_private.invoice_data(org uuid, req jsonb, prior lms.records) returns jsonb
language plpgsql security definer set search_path='' as $$
declare config lms.config_revisions; source lms.records; customer lms.records; work_record lms.records;
 d jsonb; p jsonb; old_ids jsonb; new_ids jsonb; expected_keys text[];
begin
 if not lms.has_role(org,array['owner','admin']) then raise exception 'Only current owners or admins manage invoice drafts' using errcode='42501'; end if;
 select * into config from lms.config_revisions where organization_id=org order by revision desc limit 1;
 if config.revision is distinct from (req->>'configRevision')::integer then raise exception 'Configuration changed; review the current revision' using errcode='23514'; end if;
 if not exists(select 1 from jsonb_array_elements(config.document->'modules') m where m->>'id'='invoice-drafts' and m->>'version'='1.0.0')
    or not exists(select 1 from jsonb_array_elements(config.document->'modules') m where m->>'id'='estimates')
    or not exists(select 1 from jsonb_array_elements(config.document->'entities') e where e->>'id'='invoice-drafts' and e->>'module'='invoice-drafts') then
  raise exception 'Explicitly enable the reviewed Invoice Drafts module first' using errcode='23514';
 end if;
 if jsonb_typeof(req) is distinct from 'object' or req->>'acknowledgement' is distinct from 'FICTIONAL DRAFT — NOT ISSUED'
    or jsonb_typeof(req->'configRevision') is distinct from 'number' or coalesce(req->>'configRevision','') !~ '^[1-9]\d{0,9}$' then
  raise exception 'Explicitly confirm a fictional unissued draft and exact configuration revision' using errcode='23514'; end if;
 if req->>'kind'='convert' then
  expected_keys:=array['kind','configRevision','acknowledgement','estimateId','estimateRevision'];
  if prior.id is not null or jsonb_typeof(req->'estimateRevision') is distinct from 'number' or coalesce(req->>'estimateRevision','') !~ '^[1-9]\d{0,9}$' then raise exception 'Invalid source revision' using errcode='23514'; end if;
  select * into source from lms.records where organization_id=org and id=(req->>'estimateId')::uuid and entity='estimates' and revision=(req->>'estimateRevision')::integer and not archived and data->>'status'='Reviewed draft';
  if source.id is null then raise exception 'Use the exact current, active, reviewed estimate revision' using errcode='23514'; end if;
  select * into customer from lms.records where organization_id=org and id=(source.data->>'customer')::uuid and entity='customers' and not archived;
  if customer.id is null then raise exception 'An active same-organization customer is required' using errcode='23514'; end if;
  if nullif(source.data->>'work','') is not null then
   select * into work_record from lms.records where organization_id=org and id=(source.data->>'work')::uuid and not archived;
   if work_record.id is null or work_record.data->>'customer' is distinct from customer.id::text then raise exception 'Active linked work must retain this customer' using errcode='23514'; end if;
  end if;
  -- Copy the whole already verified pricing snapshot, not current catalog prices.
  select jsonb_object_agg(k,v) into d from jsonb_each(source.data) t(k,v) where k=any(array['title','customer','work','appointment','zone','as_of','pricing','notes']);
  d:=d||jsonb_build_object('notice','FICTIONAL DRAFT — NOT ISSUED','status','Draft','estimate',source.id,'estimate_revision',source.revision,'reason','Converted from explicitly reviewed estimate');
 else
  if prior.id is null or prior.entity<>'invoice-drafts' or prior.archived or prior.revision is distinct from (req->>'revision')::integer or prior.id is distinct from (req->>'invoiceId')::uuid or prior.data->>'status'<>'Draft' then
   raise exception 'Invoice draft changed or is void; reload before continuing' using errcode='23514'; end if;
  if jsonb_typeof(req->'reason') is distinct from 'string' or length(btrim(req->>'reason')) not between 8 and 500 then raise exception 'Explain the correction or void in 8–500 characters' using errcode='23514'; end if;
  if req->>'kind'='correct' then
   expected_keys:=array['kind','configRevision','acknowledgement','invoiceId','revision','reason','notes','pricing'];
   if jsonb_typeof(req->'notes') is distinct from 'string' or length(req->>'notes')>4000 then raise exception 'Invalid internal notes' using errcode='23514'; end if;
   p:=lms_private.estimate_selection(req->'pricing');
   select jsonb_agg(x->'id' order by n) into old_ids from jsonb_array_elements(prior.data->'pricing'->'lines') with ordinality t(x,n);
   select jsonb_agg(x->'id' order by n) into new_ids from jsonb_array_elements(p->'lines') with ordinality t(x,n);
   if old_ids is distinct from new_ids then raise exception 'Retain saved lines and order; only quantity, line notes, discount and manual tax corrections are supported' using errcode='23514'; end if;
   d:=prior.data||jsonb_build_object('notes',btrim(req->>'notes'),'reason',btrim(req->>'reason'),'pricing',p);
   d:=d||jsonb_build_object('pricing',lms_private.estimate_pricing(org,d,prior.data));
  elsif req->>'kind'='void' then
   expected_keys:=array['kind','configRevision','acknowledgement','invoiceId','revision','reason'];
   d:=prior.data||jsonb_build_object('status','Void','reason',btrim(req->>'reason'));
  else raise exception 'Unsupported invoice draft action' using errcode='23514'; end if;
 end if;
 if exists(select 1 from jsonb_object_keys(req) k where not k=any(expected_keys)) or (select count(*) from jsonb_object_keys(req))<>cardinality(expected_keys) then raise exception 'Unexpected or missing invoice command fields' using errcode='23514'; end if;
 return d;
end; $$;

create function lms_private.invoice_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare req jsonb:=nullif(current_setting('lms.invoice_command',true),'')::jsonb; prior lms.records; config_rev integer;
begin
 if new.entity<>'invoice-drafts' then
  if tg_op='UPDATE' and new.data->>'customer' is distinct from old.data->>'customer' and exists(select 1 from lms.record_links l join lms.invoice_origins i on i.organization_id=l.organization_id and i.record_id=l.source_id where l.organization_id=new.organization_id and l.target_id=new.id and l.field_key='work') then raise exception 'Invoiced work retains its historical customer link' using errcode='23514'; end if;
  return new;
 end if;
 -- Same ordering as normal Engine writes/publication. A row update fences frozen snapshots.
 perform 1 from lms.organizations where id=new.organization_id for update;
 insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 if req is null or nullif(current_setting('lms.invoice_operation',true),'') is null or new.archived then raise exception 'Use the explicit invoice command; invoice drafts cannot be archived or deleted' using errcode='23514'; end if;
 if tg_op='UPDATE' then prior:=old; end if;
 select max(revision) into config_rev from lms.config_revisions where organization_id=new.organization_id;
 if new.config_revision<>config_rev or new.data is distinct from lms_private.invoice_data(new.organization_id,req,prior) then raise exception 'Invoice draft must match its reviewed source or correction exactly' using errcode='23514'; end if;
 return new;
end; $$;
create trigger record_invoice_guard before insert or update on lms.records for each row execute function lms_private.invoice_guard();
create function lms_private.invoice_projection() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.entity='invoice-drafts' then
  if tg_op='INSERT' then insert into lms.invoice_origins values(new.organization_id,new.id,(new.data->>'estimate')::uuid,(new.data->>'estimate_revision')::integer); end if;
  insert into lms.invoice_versions values(new.organization_id,new.id,new.revision,new.config_revision,new.data,lms.current_user_id(),current_setting('lms.invoice_operation')::uuid,now());
  insert into lms.record_operations values(new.organization_id,current_setting('lms.invoice_operation')::uuid,lms.current_user_id(),new.id,jsonb_build_object('kind','invoice-command','input',current_setting('lms.invoice_command')::jsonb),to_jsonb(new));
 end if;
 return new;
end; $$;
create trigger record_invoice_projection after insert or update on lms.records for each row execute function lms_private.invoice_projection();

create function lms.write_invoice_draft(org uuid, operation uuid, req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt lms.record_operations; prior lms.records; result lms.records; config_rev integer; d jsonb;
begin
 if operation is null then raise exception 'Invoice commands require an operation identifier' using errcode='23514'; end if;
 perform 1 from lms.organizations where id=org for update;
 if not lms.has_role(org,array['owner','admin']) then raise exception 'Only current owners or admins manage invoice drafts' using errcode='42501'; end if;
 -- Ownership operations use the same organization lock; epoch also fences raw record mutations.
 insert into lms_private.record_epochs(organization_id,epoch) values(org,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 select * into receipt from lms.record_operations where organization_id=org and operation_id=operation;
 if found then
  if receipt.actor_id is distinct from lms.current_user_id() or receipt.request is distinct from jsonb_build_object('kind','invoice-command','input',req) then raise exception 'Operation identifier belongs to another actor or request' using errcode='23514'; end if;
  return receipt.result;
 end if;
 if req->>'kind'<>'convert' then
  select * into prior from lms.records where organization_id=org and id=(req->>'invoiceId')::uuid and entity='invoice-drafts' for update;
 end if;
 d:=lms_private.invoice_data(org,req,prior);
 select max(revision) into config_rev from lms.config_revisions where organization_id=org;
 perform set_config('lms.record_command','',true);
 perform set_config('lms.invoice_command',req::text,true);
 perform set_config('lms.invoice_operation',operation::text,true);
 if req->>'kind'='convert' then
  if (select count(*) from lms.records where organization_id=org)>=250 then raise exception 'Fictional workspace record quota reached' using errcode='23514'; end if;
  insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values(org,'invoice-drafts',d,config_rev,lms.current_user_id(),lms.current_user_id()) returning * into result;
 else
  update lms.records set data=d,config_revision=config_rev where organization_id=org and id=prior.id returning * into result;
 end if;
 perform set_config('lms.invoice_command','',true);
 perform set_config('lms.invoice_operation','',true);
 return to_jsonb(result);
end; $$;
revoke all on function lms_private.invoice_immutable(),lms_private.invoice_data(uuid,jsonb,lms.records),lms_private.invoice_guard(),lms_private.invoice_projection() from public,lms_app;
revoke all on function lms.write_invoice_draft(uuid,uuid,jsonb) from public;
grant execute on function lms.write_invoice_draft(uuid,uuid,jsonb) to lms_app;
