-- Additive internal pricing module. No invoices, payments, messages or activation changes.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before pricing migration' using errcode='55000'; end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
do $$ begin
 if exists(select 1 from lms.records where entity in ('pricing-zones','services','service-rates','estimates')) then raise exception 'Untracked pricing records require a reviewed migration'; end if;
end; $$;
create table lms.service_rates (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 record_id uuid not null,service_id uuid not null,zone_id uuid not null,
 amount_minor bigint not null check(amount_minor between 0 and 999999999999),
 starts_on date not null,ends_on date,archived boolean not null,
 primary key(organization_id,record_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,service_id) references lms.records(organization_id,id),
 foreign key(organization_id,zone_id) references lms.records(organization_id,id),
 check(starts_on between date '2020-01-01' and date '2100-12-31' and (ends_on is null or (ends_on>starts_on and ends_on<=date '2101-01-01'))),
 constraint exclusive_service_rate exclude using gist(organization_id with =,service_id with =,zone_id with =,daterange(starts_on,ends_on,'[)') with &&) where(not archived)
);
create table lms.estimate_lines (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 estimate_id uuid not null,line_id uuid not null,rate_id uuid not null,service_id uuid not null,parent_service_id uuid,snapshot jsonb not null,
 primary key(organization_id,estimate_id,line_id),
 foreign key(organization_id,estimate_id) references lms.records(organization_id,id) on delete cascade,
 foreign key(organization_id,rate_id) references lms.records(organization_id,id),
 foreign key(organization_id,service_id) references lms.records(organization_id,id),
 foreign key(organization_id,parent_service_id) references lms.records(organization_id,id)
);
create index estimate_lines_rate on lms.estimate_lines(organization_id,rate_id);
create table lms.estimate_versions (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 record_id uuid not null,revision integer not null,data jsonb not null,archived boolean not null,
 occurred_at timestamptz not null default now(),
 primary key(organization_id,record_id,revision),
 foreign key(organization_id,record_id) references lms.records(organization_id,id) on delete cascade
);
alter table lms.service_rates enable row level security;
alter table lms.service_rates force row level security;
alter table lms.estimate_lines enable row level security;
alter table lms.estimate_lines force row level security;
alter table lms.estimate_versions enable row level security;
alter table lms.estimate_versions force row level security;
create policy read_service_rates on lms.service_rates for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_estimate_lines on lms.estimate_lines for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_estimate_versions on lms.estimate_versions for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
revoke all on lms.service_rates,lms.estimate_lines,lms.estimate_versions from public,lms_app;
grant select on lms.service_rates,lms.estimate_lines,lms.estimate_versions to lms_app;

create function lms_private.price_quantity(v text) returns bigint language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if v is null or v !~ '^(0|[1-9]\d{0,6})(\.\d{1,3})?$' then raise exception 'Invalid estimate quantity' using errcode='23514'; end if;
 n:=v::numeric*1000;
 if n<=0 or n>1000000000 then raise exception 'Quantity is outside the supported range' using errcode='23514'; end if;
 return n::bigint;
end; $$;
create function lms_private.estimate_selection(p jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare l jsonb; lines jsonb:='[]'; seen uuid[]:='{}'; line_id uuid; q bigint; dk text; dv text; tm text; bp text; label text;
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'currency' is distinct from 'USD' or p->>'acknowledgement' is distinct from 'FICTIONAL DRAFT ONLY'
   or jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 10 then
  raise exception 'Use 1–10 lines and explicitly acknowledge a fictional USD draft' using errcode='23514';
 end if;
 for l in select * from jsonb_array_elements(p->'lines') loop
  if jsonb_typeof(l) is distinct from 'object' or jsonb_typeof(l->'id') is distinct from 'string' or jsonb_typeof(l->'rateId') is distinct from 'string'
     or jsonb_typeof(l->'rateRevision') is distinct from 'number' or coalesce(l->>'rateRevision','') !~ '^[1-9]\d{0,9}$' or (l->>'rateRevision')::numeric>2147483647
     or jsonb_typeof(l->'serviceRevision') is distinct from 'number' or coalesce(l->>'serviceRevision','') !~ '^[1-9]\d{0,9}$' or (l->>'serviceRevision')::numeric>2147483647
     or jsonb_typeof(l->'quantity') is distinct from 'string' or (l ? 'note' and jsonb_typeof(l->'note') is distinct from 'string') or length(coalesce(l->>'note',''))>500 then
   raise exception 'Invalid estimate line fields or revisions' using errcode='23514';
  end if;
  line_id:=(l->>'id')::uuid;
  if line_id=any(seen) then raise exception 'Duplicate estimate line identifier' using errcode='23514'; end if;
  seen:=array_append(seen,line_id);q:=lms_private.price_quantity(l->>'quantity');
  lines:=lines||jsonb_build_array(jsonb_build_object('id',line_id,'rateId',(l->>'rateId')::uuid,'rateRevision',(l->>'rateRevision')::integer,'serviceRevision',(l->>'serviceRevision')::integer,
   'quantity',trim_scale(q::numeric/1000)::text,'note',btrim(coalesce(l->>'note',''))));
 end loop;
 dk:=p->'discount'->>'kind';dv:=p->'discount'->>'value';tm:=p->'tax'->>'mode';bp:=p->'tax'->>'basisPoints';label:=btrim(p->'tax'->>'label');
 if jsonb_typeof(p->'discount') is distinct from 'object' or jsonb_typeof(p->'discount'->'value') is distinct from 'string' or dk is null or dk not in ('None','Amount','Percent') or dv is null or dv !~ '^(0|[1-9]\d{0,11})$'
    or (dk='None' and dv<>'0') or (dk='Percent' and dv::numeric>10000)
    or jsonb_typeof(p->'tax') is distinct from 'object' or jsonb_typeof(p->'tax'->'basisPoints') is distinct from 'string' or tm is null or tm not in ('None','Manual') or bp is null or bp !~ '^(0|[1-9]\d{0,4})$' or bp::numeric>10000
    or jsonb_typeof(p->'tax'->'label') is distinct from 'string' or length(label)>80 or (tm='Manual' and label='') or (tm='None' and (bp<>'0' or label<>'')) then
  raise exception 'Invalid discount or explicit manual-tax configuration' using errcode='23514';
 end if;
 return jsonb_build_object('currency','USD','lines',lines,'discount',jsonb_build_object('kind',dk,'value',dv),'tax',jsonb_build_object('mode',tm,'basisPoints',bp,'label',label),'acknowledgement','FICTIONAL DRAFT ONLY');
end; $$;
create function lms_private.pricing_label(org uuid, target uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce(r.data->>(select e->>'titleField' from lms.config_revisions c cross join lateral jsonb_array_elements(c.document->'entities') e where c.organization_id=org and e->>'id'=r.entity order by c.revision desc limit 1),'Record')
 from lms.records r where r.organization_id=org and r.id=target;
$$;
create function lms_private.estimate_pricing(org uuid, input_data jsonb, prior jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb:=lms_private.estimate_selection(input_data->'pricing');l jsonb;old_line jsonb;snap jsonb;lines jsonb:='[]';rate lms.service_rates;rate_record lms.records;service lms.records;zone lms.records;
 q bigint;line_total numeric;subtotal numeric:=0;discount numeric;tax numeric;total numeric;day date;
begin
 day:=(input_data->>'as_of')::date;
 if day is null or day not between date '2020-01-01' and date '2100-12-31' or to_char(day,'YYYY-MM-DD')<>input_data->>'as_of' then raise exception 'Invalid estimate pricing date' using errcode='23514'; end if;
 select * into zone from lms.records where organization_id=org and id=(input_data->>'zone')::uuid and entity='pricing-zones';
 if zone.id is null then raise exception 'Pricing zone must belong to this workspace' using errcode='23514'; end if;
 for l in select * from jsonb_array_elements(p->'lines') loop
  select x into old_line from jsonb_array_elements(prior->'pricing'->'lines') x where x->>'id'=l->>'id';
  if old_line is not null then
   if (old_line->>'rateId',old_line->>'rateRevision',old_line->>'serviceRevision') is distinct from (l->>'rateId',l->>'rateRevision',l->>'serviceRevision') then
    raise exception 'Retained line pricing is fixed; remove and add a new line to select current prices' using errcode='23514';
   end if;
   snap:=old_line->'snapshot';
  else
   select * into rate from lms.service_rates where organization_id=org and record_id=(l->>'rateId')::uuid and not archived;
   select * into rate_record from lms.records where organization_id=org and id=rate.record_id and entity='service-rates' and not archived;
   select * into service from lms.records where organization_id=org and id=rate.service_id and entity='services' and not archived;
   if rate.record_id is null or rate_record.id is null or service.id is null or zone.archived or rate.zone_id<>zone.id or day<rate.starts_on or (rate.ends_on is not null and day>=rate.ends_on) then
    raise exception 'No active rate for this service area and pricing date' using errcode='23514';
   end if;
   if rate_record.revision<>(l->>'rateRevision')::integer or service.revision<>(l->>'serviceRevision')::integer then
    raise exception 'Catalog price or description changed; reload and explicitly select the current rate' using errcode='23514';
   end if;
   snap:=jsonb_build_object('serviceId',service.id,'serviceRevision',service.revision,'rateId',rate.record_id,'rateRevision',rate_record.revision,
    'name',service.data->>'name','description',coalesce(service.data->>'description',''),'category',coalesce(service.data->>'category',''),'mode',service.data->>'mode','unit',service.data->>'unit',
    'kind',service.data->>'kind','parent',nullif(service.data->>'parent',''),'amountMinor',rate.amount_minor::text,'zoneId',zone.id,'zoneName',zone.data->>'name','effectiveFrom',rate.starts_on::text,'effectiveUntil',rate.ends_on::text);
  end if;
  q:=lms_private.price_quantity(l->>'quantity');
  if snap->>'mode'='Fixed' and q<>1000 then raise exception 'Fixed-price services require quantity 1' using errcode='23514'; end if;
  line_total:=trunc(((snap->>'amountMinor')::numeric*q+500)/1000);
  subtotal:=subtotal+line_total;
  if line_total>999999999999 or subtotal>999999999999 then raise exception 'Calculated amount exceeds the supported limit' using errcode='23514'; end if;
  lines:=lines||jsonb_build_array(l||jsonb_build_object('snapshot',snap,'amountMinor',line_total::bigint::text));
 end loop;
 if exists(select 1 from jsonb_array_elements(lines) x where x->'snapshot'->>'kind'='Extra' and not exists(select 1 from jsonb_array_elements(lines) b where b->'snapshot'->>'kind'='Service' and b->'snapshot'->>'serviceId'=x->'snapshot'->>'parent')) then
  raise exception 'An extra requires its matching base service' using errcode='23514';
 end if;
 discount:=case p->'discount'->>'kind' when 'None' then 0 when 'Amount' then (p->'discount'->>'value')::numeric else trunc((subtotal*(p->'discount'->>'value')::numeric+5000)/10000) end;
 if discount>subtotal then raise exception 'Discount cannot exceed the subtotal' using errcode='23514'; end if;
 tax:=case when p->'tax'->>'mode'='None' then 0 else trunc(((subtotal-discount)*(p->'tax'->>'basisPoints')::numeric+5000)/10000) end;
 total:=subtotal-discount+tax;
 if tax>999999999999 or total>999999999999 then raise exception 'Calculated amount exceeds the supported limit' using errcode='23514'; end if;
 return p||jsonb_build_object('lines',lines,'customerName',coalesce(prior->'pricing'->>'customerName',lms_private.pricing_label(org,(input_data->>'customer')::uuid)),
  'workTitle',coalesce(prior->'pricing'->>'workTitle',lms_private.pricing_label(org,nullif(input_data->>'work','')::uuid),''),
  'appointmentTitle',coalesce(prior->'pricing'->>'appointmentTitle',lms_private.pricing_label(org,nullif(input_data->>'appointment','')::uuid),''),
  'subtotalMinor',subtotal::bigint::text,'discountMinor',discount::bigint::text,'taxMinor',tax::bigint::text,'totalMinor',total::bigint::text);
end; $$;

-- Host-only preview/materialization: role + epoch checked before any catalog snapshot is selected.
create function lms.prepare_estimate(org uuid, input_data jsonb, prior_id uuid default null, expected_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior lms.records;
begin
 if not lms.has_role(org,array['owner','admin']) then raise exception 'Only owners or admins prepare fictional estimate drafts' using errcode='42501'; end if;
 insert into lms_private.record_epochs(organization_id,epoch) values(org,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 if prior_id is not null then
  select * into prior from lms.records where organization_id=org and id=prior_id and entity='estimates' and revision=expected_revision and not archived;
  if not found then raise exception 'Estimate changed or is archived; reload before editing' using errcode='23514'; end if;
 end if;
 return input_data||jsonb_build_object('pricing',lms_private.estimate_pricing(org,input_data,prior.data));
end; $$;
revoke all on function lms.prepare_estimate(uuid,jsonb,uuid,integer) from public;
grant execute on function lms.prepare_estimate(uuid,jsonb,uuid,integer) to lms_app;

create function lms_private.pricing_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare target lms.records;config jsonb;definition jsonb;start_day date;end_day date;expected jsonb;
begin
 if new.entity not in ('pricing-zones','services','service-rates','estimates') then
  if tg_op='UPDATE' and new.data->>'customer' is distinct from old.data->>'customer' and exists(select 1 from lms.record_links l join lms.records r on r.organization_id=l.organization_id and r.id=l.source_id where l.organization_id=new.organization_id and l.target_id=new.id and l.field_key='work' and r.entity='estimates') then
   raise exception 'Estimated work retains its customer relationship; create another work record' using errcode='23514';
  end if;
  return new;
 end if;
 if not lms.has_role(new.organization_id,array['owner','admin']) then raise exception 'Only owners or admins manage service pricing and estimate drafts' using errcode='42501'; end if;
 select document into config from lms.config_revisions where organization_id=new.organization_id order by revision desc limit 1;
 select e into definition from jsonb_array_elements(config->'entities') e where e->>'id'=new.entity;
 if definition->>'module' is distinct from 'estimates' then raise exception 'Pricing module contract is required' using errcode='23514'; end if;
 if exists(select 1 from jsonb_object_keys(new.data) k where not exists(select 1 from jsonb_array_elements(definition->'fields') f where f->>'key'=k)) then raise exception 'Unknown pricing record field' using errcode='23514'; end if;
 if new.entity in ('service-rates','estimates') and (jsonb_typeof(new.data->'title') is distinct from 'string' or nullif(btrim(new.data->>'title'),'') is null) then raise exception 'A pricing record title is required' using errcode='23514'; end if;
 if new.entity='pricing-zones' and nullif(btrim(new.data->>'name'),'') is null then raise exception 'Name the pricing zone' using errcode='23514';
 elsif new.entity='services' then
  if nullif(btrim(new.data->>'name'),'') is null or nullif(btrim(new.data->>'unit'),'') is null or coalesce(new.data->>'mode','') not in ('Fixed','Hourly','Per unit','Quantity') or coalesce(new.data->>'kind','') not in ('Service','Extra')
    or ((new.data->>'kind'='Extra')<>(nullif(new.data->>'parent','') is not null)) then raise exception 'Invalid service unit, pricing mode or extra parent' using errcode='23514'; end if;
  if new.data->>'kind'='Extra' and not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'parent')::uuid and entity='services' and data->>'kind'='Service' and id<>new.id) then raise exception 'Extras need a same-workspace base service' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.data->>'mode',new.data->>'unit',new.data->>'kind',nullif(new.data->>'parent','')) is distinct from (old.data->>'mode',old.data->>'unit',old.data->>'kind',nullif(old.data->>'parent','')) and exists(select 1 from lms.service_rates where organization_id=new.organization_id and service_id=new.id) then raise exception 'A priced service retains its method, unit and extra relationship; create another service' using errcode='23514'; end if;
 elsif new.entity='service-rates' then
  if jsonb_typeof(new.data->'amount') is distinct from 'string' or coalesce(new.data->>'amount','') !~ '^(0|[1-9]\d{0,11})$' then raise exception 'Rates use nonnegative exact USD minor-unit strings' using errcode='23514'; end if;
  start_day:=(new.data->>'effective_from')::date;end_day:=nullif(new.data->>'effective_until','')::date;
  if start_day is null or start_day not between date '2020-01-01' and date '2100-12-31' or to_char(start_day,'YYYY-MM-DD')<>new.data->>'effective_from'
     or (end_day is not null and (end_day<=start_day or end_day>date '2101-01-01' or to_char(end_day,'YYYY-MM-DD')<>new.data->>'effective_until'))
     or not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'service')::uuid and entity='services')
     or not exists(select 1 from lms.records where organization_id=new.organization_id and id=(new.data->>'zone')::uuid and entity='pricing-zones') then raise exception 'Invalid service rate relationship or effective date range' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.data->>'service',new.data->>'zone') is distinct from (old.data->>'service',old.data->>'zone') then raise exception 'A rate retains its service and area; create another rate' using errcode='23514'; end if;
 elsif new.entity='estimates' then
  if coalesce(new.data->>'status','') not in ('Draft','Reviewed draft','Void') or (tg_op='INSERT' and (new.data->>'status'<>'Draft' or new.archived)) then raise exception 'Estimates begin as unarchived internal drafts' using errcode='23514'; end if;
  if tg_op='UPDATE' then
   if (new.data->>'customer',nullif(new.data->>'work',''),nullif(new.data->>'appointment',''),new.data->>'zone',new.data->>'as_of') is distinct from (old.data->>'customer',nullif(old.data->>'work',''),nullif(old.data->>'appointment',''),old.data->>'zone',old.data->>'as_of') then raise exception 'Estimate customer, work, area and pricing date are retained; create a new draft' using errcode='23514'; end if;
   if (old.data->>'status'='Void' and new.data is distinct from old.data) or (old.data->>'status'='Reviewed draft' and (new.data-'status') is distinct from (old.data-'status'))
      or (new.data->>'status'='Void' and (new.data-'status') is distinct from (old.data-'status')) then raise exception 'Reviewed or void drafts retain their content; reopen a reviewed draft before editing' using errcode='23514'; end if;
  end if;
  if nullif(new.data->>'work','') is not null then
   select * into target from lms.records where organization_id=new.organization_id and id=(new.data->>'work')::uuid;
   if target.id is null or target.data->>'customer' is distinct from new.data->>'customer' then raise exception 'Estimate work must link to this customer' using errcode='23514'; end if;
  end if;
  if nullif(new.data->>'appointment','') is not null then
   select * into target from lms.records where organization_id=new.organization_id and id=(new.data->>'appointment')::uuid and entity='appointments';
   if target.id is null or target.data->>'customer' is distinct from new.data->>'customer' or (nullif(new.data->>'work','') is not null and target.data->>'work' is distinct from new.data->>'work') then raise exception 'Estimate appointment must link to this customer and work' using errcode='23514'; end if;
  end if;
  expected:=lms_private.estimate_pricing(new.organization_id,new.data,case when tg_op='UPDATE' then old.data else null end);
  if expected is distinct from new.data->'pricing' then raise exception 'Estimate pricing snapshot or totals do not match verified catalog/history and exact arithmetic' using errcode='23514'; end if;
 end if;
 return new;
end; $$;
-- Alphabetical order follows the existing relationship/epoch trigger, before workforce checks.
create trigger record_services_guard before insert or update on lms.records for each row execute function lms_private.pricing_guard();
create function lms_private.pricing_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare l jsonb;
begin
 if new.entity='service-rates' then
  insert into lms.service_rates values(new.organization_id,new.id,(new.data->>'service')::uuid,(new.data->>'zone')::uuid,(new.data->>'amount')::bigint,(new.data->>'effective_from')::date,nullif(new.data->>'effective_until','')::date,new.archived)
  on conflict(organization_id,record_id) do update set amount_minor=excluded.amount_minor,starts_on=excluded.starts_on,ends_on=excluded.ends_on,archived=excluded.archived;
 elsif new.entity='estimates' then
  delete from lms.estimate_lines where organization_id=new.organization_id and estimate_id=new.id;
  for l in select * from jsonb_array_elements(new.data->'pricing'->'lines') loop
   insert into lms.estimate_lines values(new.organization_id,new.id,(l->>'id')::uuid,(l->>'rateId')::uuid,(l->'snapshot'->>'serviceId')::uuid,(l->'snapshot'->>'parent')::uuid,l);
  end loop;
  insert into lms.estimate_versions(organization_id,record_id,revision,data,archived) values(new.organization_id,new.id,new.revision,new.data,new.archived);
 end if;
 return new;
end; $$;
create trigger record_services_projection after insert or update on lms.records for each row execute function lms_private.pricing_projection();
revoke all on function lms_private.price_quantity(text),lms_private.estimate_selection(jsonb),lms_private.pricing_label(uuid,uuid),lms_private.estimate_pricing(uuid,jsonb,jsonb),lms_private.pricing_guard(),lms_private.pricing_projection() from public,lms_app;

-- Existing receipts bind original selections; derived pricing is independently checked above.
create or replace function lms_private.relationship_projection() returns trigger language plpgsql security definer set search_path='' as $$
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
   if request->>'entity' is distinct from new.entity or (case when new.entity='estimates' then ((request->'data')-'pricing') is distinct from (new.data-'pricing') or lms_private.estimate_selection(request->'data'->'pricing') is distinct from lms_private.estimate_selection(new.data->'pricing') else request->'data' is distinct from new.data end) or new.archived or (tg_op='INSERT' and request->'existing'<>'null'::jsonb) or (tg_op='UPDATE' and (request->'existing'->>'id' is distinct from new.id::text or (request->'existing'->>'revision')::integer is distinct from old.revision or old.archived)) then raise exception 'Record command does not match its mutation' using errcode='23514'; end if;
  elsif request->>'kind'='archive' then
   if tg_op<>'UPDATE' or request->>'recordId' is distinct from new.id::text or (request->>'revision')::integer is distinct from old.revision or (request->>'archived')::boolean is distinct from new.archived or new.data is distinct from old.data then raise exception 'Archive command does not match its mutation' using errcode='23514'; end if;
  else raise exception 'Unsupported record command' using errcode='23514'; end if;
  insert into lms.record_operations values(new.organization_id,(command->>'operationId')::uuid,lms.current_user_id(),new.id,request,to_jsonb(new));
 end if;
 return new;
end; $$;
