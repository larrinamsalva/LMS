-- Optional fictional reusable equipment. No consumable movements, scheduling, accounting or activation.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before equipment migration' using errcode='55000'; end if;
end; $$;
lock table lms.records,lms.config_revisions in access exclusive mode nowait;
do $$ begin if exists(select 1 from lms.records where entity='equipment') then raise exception 'Untracked equipment requires separate review';end if;end; $$;
create table lms.equipment_state (
 organization_id uuid not null references lms.organizations(id),record_id uuid not null,revision integer not null check(revision>0),
 asset_key text not null,barcode_key text,
 condition text not null check(condition in ('Serviceable','Needs inspection','Under maintenance','Out of service','Retired')),
 maintenance text not null check(maintenance in ('Initial inspection','Clear','Problem reported','Task opened','Service recorded','Retired')),
 work_id uuid,technician_id uuid,last_service date,next_inspection date,
 primary key(organization_id,record_id),unique(organization_id,asset_key),unique(organization_id,barcode_key),
 foreign key(organization_id,record_id) references lms.records(organization_id,id),
 foreign key(organization_id,work_id) references lms.records(organization_id,id),
 foreign key(organization_id,technician_id) references lms.records(organization_id,id),
 check((condition='Serviceable')=(maintenance='Clear') and (condition='Retired')=(maintenance='Retired'))
);
create table lms.equipment_checkouts (
 organization_id uuid not null references lms.organizations(id),id uuid not null default gen_random_uuid(),equipment_id uuid not null,
 revision integer not null check(revision>0),employee_id uuid not null,employee_revision integer not null,
 resource_id uuid,membership_id uuid,membership_revision integer,work_id uuid,
 checked_out_at timestamptz not null,expected_return_at timestamptz not null,returned_at timestamptz,
 status text not null check(status in ('Checked out','In use','Returned')),return_condition text,
 checked_out_by uuid not null references lms.users(id),returned_by uuid references lms.users(id),
 primary key(organization_id,id),
 foreign key(organization_id,equipment_id) references lms.records(organization_id,id),
 foreign key(organization_id,employee_id) references lms.records(organization_id,id),
 foreign key(organization_id,resource_id) references lms.records(organization_id,id),
 foreign key(organization_id,membership_id) references lms.records(organization_id,id),
 foreign key(organization_id,work_id) references lms.records(organization_id,id),
 check(expected_return_at>checked_out_at and expected_return_at<=checked_out_at+interval '366 days' and (returned_at is null or returned_at>=checked_out_at)),
 check((returned_at is null)=(status<>'Returned') and (returned_at is null)=(returned_by is null))
);
create unique index equipment_one_checkout on lms.equipment_checkouts(organization_id,equipment_id) where returned_at is null;
create index equipment_checkout_timeline on lms.equipment_checkouts(organization_id,equipment_id,checked_out_at);
create index equipment_employee_checkout on lms.equipment_checkouts(organization_id,employee_id) where returned_at is null;
create index equipment_resource_checkout on lms.equipment_checkouts(organization_id,resource_id) where returned_at is null;
create index equipment_work_checkout on lms.equipment_checkouts(organization_id,work_id) where returned_at is null;
create table lms.equipment_events (
 organization_id uuid not null references lms.organizations(id),record_id uuid not null,revision integer not null,config_revision integer not null,
 action text not null,data jsonb not null,state jsonb not null,checkout jsonb,notes text not null,
 actor_id uuid not null references lms.users(id),operation_id uuid not null,occurred_at timestamptz not null default now(),
 primary key(organization_id,record_id,revision),unique(organization_id,operation_id),
 foreign key(organization_id,record_id) references lms.records(organization_id,id),
 foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision)
);
alter table lms.equipment_state enable row level security;
alter table lms.equipment_state force row level security;
alter table lms.equipment_checkouts enable row level security;
alter table lms.equipment_checkouts force row level security;
alter table lms.equipment_events enable row level security;
alter table lms.equipment_events force row level security;
revoke all on lms.equipment_state,lms.equipment_checkouts,lms.equipment_events from public,lms_app;
grant select on lms.equipment_state,lms.equipment_checkouts,lms.equipment_events to lms_app;
create policy read_equipment_state on lms.equipment_state for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_equipment_checkouts on lms.equipment_checkouts for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy read_equipment_events on lms.equipment_events for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create function lms_private.equipment_history_guard() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Equipment history and completed checkouts are retained' using errcode='23514';end; $$;
create trigger equipment_event_immutable before update or delete on lms.equipment_events for each row execute function lms_private.equipment_history_guard();
create trigger equipment_checkout_retained before delete on lms.equipment_checkouts for each row execute function lms_private.equipment_history_guard();
create trigger equipment_completed_immutable before update on lms.equipment_checkouts for each row when(old.returned_at is not null) execute function lms_private.equipment_history_guard();

create function lms_private.equipment_instant(v text) returns timestamptz language plpgsql immutable set search_path='' as $$
declare t timestamptz;
begin
 if v is null or v !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(Z|[+-]\d\d:\d\d)$' then raise exception 'Use explicit-offset equipment times' using errcode='23514';end if;
 t:=v::timestamptz;
 if not isfinite(t) or date_trunc('minute',t)<>t or t<timestamptz '2020-01-01 00:00Z' or t>=timestamptz '2101-01-01 00:00Z' then raise exception 'Equipment times require whole minutes within 2020–2100' using errcode='23514';end if;
 return t;
end; $$;
create function lms_private.equipment_date(v text) returns date language plpgsql immutable set search_path='' as $$
declare d date;
begin d:=v::date;if d is null or to_char(d,'YYYY-MM-DD')<>v or d not between date '2020-01-01' and date '2100-12-31' then raise exception 'Use a valid equipment service date within 2020–2100' using errcode='23514';end if;return d;end; $$;
create function lms_private.equipment_reference(org uuid,target uuid,expected integer,allowed text[]) returns lms.records language plpgsql security definer set search_path='' as $$
declare r lms.records;
begin
 select * into r from lms.records where organization_id=org and id=target and revision=expected and entity=any(allowed) and not archived;
 if r.id is null or not exists(select 1 from lms.config_revisions c cross join lateral jsonb_array_elements(c.document->'entities') e join jsonb_array_elements(c.document->'modules') m on m->>'id'=e->>'module' where c.organization_id=org and c.revision=(select max(revision) from lms.config_revisions where organization_id=org) and e->>'id'=r.entity) then raise exception 'Review an active same-organization related record and its exact revision' using errcode='23514';end if;
 if r.entity='employees' and r.data->>'status' is distinct from 'Active' then raise exception 'Equipment assignments and service require an active employee' using errcode='23514';end if;
 return r;
end; $$;
create function lms_private.equipment_operator(org uuid,kind text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from lms.memberships where organization_id=org and user_id=lms.current_user_id() for share;
 if not lms.has_role(org,array['owner','admin','staff']) then raise exception 'Current equipment operator membership required' using errcode='42501';end if;
 if kind not in ('checkout','begin-use','return','report-problem') and not lms.has_role(org,array['owner','admin']) then raise exception 'Only owners or admins approve equipment maintenance and retirement' using errcode='42501';end if;
end; $$;
-- The command and row guard share this authoritative transition validator.
create function lms_private.equipment_transition(org uuid,req jsonb,prior lms.records,s lms.equipment_state) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg lms.config_revisions;co lms.equipment_checkouts;person lms.records;resource lms.records;work_record lms.records;membership lms.resource_memberships;
 next_state jsonb:=to_jsonb(s);outcome jsonb;keys text[]:=array['kind','equipmentId','revision','configRevision','acknowledgement','notes'];started timestamptz;due timestamptz;returned timestamptz;day date;next_day date;
begin
 perform lms_private.equipment_operator(org,req->>'kind');
 if jsonb_typeof(req) is distinct from 'object' or req->>'acknowledgement' is distinct from 'CONFIRM FICTIONAL EQUIPMENT ACTION' or jsonb_typeof(req->'notes') is distinct from 'string' or length(btrim(req->>'notes')) not between 8 and 1000 then raise exception 'Explicitly confirm and describe the fictional equipment action' using errcode='23514';end if;
 select * into cfg from lms.config_revisions where organization_id=org order by revision desc limit 1;
 if cfg.revision is distinct from (req->>'configRevision')::integer or not exists(select 1 from jsonb_array_elements(cfg.document->'modules') m where m->>'id'='equipment' and m->>'version'='1.0.0') then raise exception 'Equipment configuration changed or module is disabled; review again' using errcode='23514';end if;
 if prior.id is null or prior.entity<>'equipment' or prior.archived or prior.id is distinct from (req->>'equipmentId')::uuid or prior.revision is distinct from (req->>'revision')::integer or s.revision is distinct from prior.revision or s.condition='Retired' then raise exception 'Equipment changed, is missing or retired; reload before continuing' using errcode='23514';end if;
 select * into co from lms.equipment_checkouts where organization_id=org and equipment_id=prior.id and returned_at is null;
 if req->>'kind'='checkout' then
  keys:=keys||array['employeeId','employeeRevision','resourceId','resourceRevision','workId','workRevision','checkedOutAt','expectedReturnAt'];
  if co.id is not null or s.condition<>'Serviceable' or s.maintenance<>'Clear' then raise exception 'Equipment is checked out or blocked for inspection/maintenance' using errcode='23514';end if;
  person:=lms_private.equipment_reference(org,(req->>'employeeId')::uuid,(req->>'employeeRevision')::integer,array['employees']);
  started:=lms_private.equipment_instant(req->>'checkedOutAt');due:=lms_private.equipment_instant(req->>'expectedReturnAt');
  if due<=started or due>started+interval '366 days' then raise exception 'Expected return must follow checkout within 366 days' using errcode='23514';end if;
  if exists(select 1 from lms.equipment_checkouts history where history.organization_id=org and history.equipment_id=prior.id and history.returned_at>started) or (s.last_service is not null and (started at time zone coalesce(cfg.document->>'timeZone','UTC'))::date<s.last_service) then raise exception 'Checkout cannot precede retained returns or the last service/inspection date' using errcode='23514';end if;
  if (req->>'resourceId' is null)<>(req->>'resourceRevision' is null) or (req->>'workId' is null)<>(req->>'workRevision' is null) then raise exception 'Related IDs and revisions must be reviewed together' using errcode='23514';end if;
  if req->>'resourceId' is not null then
   resource:=lms_private.equipment_reference(org,(req->>'resourceId')::uuid,(req->>'resourceRevision')::integer,array['resources']);
   if resource.data->>'kind' not in ('Worker','Crew') then raise exception 'Choose an employee Worker/Crew resource, not a calendar Equipment resource' using errcode='23514';end if;
   select * into membership from lms.resource_memberships where organization_id=org and resource_id=resource.id and employee_id=person.id and not archived and starts_at<=started and ends_at>started;
   if membership.record_id is null then raise exception 'Employee must be an effective member of the selected crew/worker resource at checkout' using errcode='23514';end if;
  end if;
  if req->>'workId' is not null then work_record:=lms_private.equipment_reference(org,(req->>'workId')::uuid,(req->>'workRevision')::integer,array['tasks','jobs']);end if;
  outcome:=jsonb_build_object('employee_id',person.id,'employee_revision',person.revision,'resource_id',resource.id,'membership_id',membership.record_id,'membership_revision',membership.revision,'work_id',work_record.id,'checked_out_at',started,'expected_return_at',due);
 elsif req->>'kind' in ('return','begin-use') then
  keys:=keys||array['checkoutId','checkoutRevision'];
  if co.id is null or co.id is distinct from (req->>'checkoutId')::uuid or co.revision is distinct from (req->>'checkoutRevision')::integer then raise exception 'Checkout changed or is already returned; review its exact revision' using errcode='23514';end if;
  if req->>'kind'='begin-use' then
   if co.status<>'Checked out' or s.condition<>'Serviceable' or s.maintenance<>'Clear' then raise exception 'Only a serviceable checked-out item can begin use' using errcode='23514';end if;
  else
   keys:=keys||array['returnedAt','condition'];returned:=lms_private.equipment_instant(req->>'returnedAt');
   if returned<co.checked_out_at or coalesce(req->>'condition','') not in ('Serviceable','Needs inspection','Out of service') then raise exception 'Use a valid actual return time and reviewed return condition' using errcode='23514';end if;
   if req->>'condition'<>'Serviceable' then
    if s.condition='Under maintenance' then next_state:=next_state||jsonb_build_object('maintenance','Task opened');
    else next_state:=next_state||jsonb_build_object('condition',req->>'condition','maintenance','Problem reported','work_id',null);end if;
   end if;
   outcome:=jsonb_build_object('returned_at',returned,'return_condition',req->>'condition');
  end if;
 elsif req->>'kind'='report-problem' then
  keys:=keys||array['condition'];
  if coalesce(req->>'condition','') not in ('Needs inspection','Out of service') then raise exception 'Report an inspection need or out-of-service condition' using errcode='23514';end if;
  next_state:=next_state||jsonb_build_object('condition',req->>'condition','maintenance','Problem reported','work_id',null);
 elsif req->>'kind'='open-maintenance' then
  keys:=keys||array['workId','workRevision'];
  if s.condition not in ('Needs inspection','Out of service') then raise exception 'Report a problem or inspection need before opening maintenance' using errcode='23514';end if;
  work_record:=lms_private.equipment_reference(org,(req->>'workId')::uuid,(req->>'workRevision')::integer,array['tasks']);
  if work_record.data->>'status'='Done' then raise exception 'Choose an open maintenance task' using errcode='23514';end if;
  next_state:=next_state||jsonb_build_object('condition','Under maintenance','maintenance','Task opened','work_id',work_record.id);
 elsif req->>'kind' in ('record-service','release') then
  keys:=keys||array['employeeId','employeeRevision','serviceDate','nextInspection'];
  if co.id is not null then raise exception 'Return equipment from custody before service/release review' using errcode='23514';end if;
  person:=lms_private.equipment_reference(org,(req->>'employeeId')::uuid,(req->>'employeeRevision')::integer,array['employees']);
  day:=lms_private.equipment_date(req->>'serviceDate');
  if s.last_service is not null and day<s.last_service then raise exception 'Service/inspection cannot predate the retained last service date' using errcode='23514';end if;
  if req->>'nextInspection' is not null then next_day:=lms_private.equipment_date(req->>'nextInspection');if next_day<=day then raise exception 'Next inspection must follow service/inspection' using errcode='23514';end if;end if;
  if req->>'kind'='record-service' then
   if s.condition<>'Under maintenance' or s.maintenance<>'Task opened' then raise exception 'Open a reviewed maintenance task first' using errcode='23514';end if;
   next_state:=next_state||jsonb_build_object('maintenance','Service recorded');
  else
   keys:=keys||array['confirmation'];
   if req->>'confirmation' is distinct from 'RETURN FICTIONAL EQUIPMENT TO SERVICE' or s.maintenance not in ('Initial inspection','Service recorded') then raise exception 'Complete required repair/service and explicitly review release; unresolved problems cannot be cleared' using errcode='23514';end if;
   if s.last_service is not null and day<s.last_service then raise exception 'Release inspection cannot predate recorded service' using errcode='23514';end if;
   next_state:=next_state||jsonb_build_object('condition','Serviceable','maintenance','Clear');
  end if;
  next_state:=next_state||jsonb_build_object('technician_id',person.id,'last_service',day,'next_inspection',next_day);
 elsif req->>'kind'='retire' then
  keys:=keys||array['confirmation'];
  if co.id is not null or req->>'confirmation' is distinct from 'RETIRE FICTIONAL EQUIPMENT' then raise exception 'Return equipment and explicitly confirm permanent retirement' using errcode='23514';end if;
  next_state:=next_state||jsonb_build_object('condition','Retired','maintenance','Retired');
 else raise exception 'Unsupported equipment action' using errcode='23514';end if;
 if exists(select 1 from jsonb_object_keys(req) k where not k=any(keys)) or (select count(*) from jsonb_object_keys(req))<>cardinality(keys) then raise exception 'Unexpected or missing equipment command fields' using errcode='23514';end if;
 return jsonb_build_object('state',next_state,'checkout',outcome);
end; $$;

create function lms_private.equipment_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare req jsonb:=nullif(current_setting('lms.equipment_command',true),'')::jsonb;command jsonb:=nullif(current_setting('lms.record_command',true),'')::jsonb;s lms.equipment_state;k text;v jsonb;cfg integer;d date;
begin
 if new.entity<>'equipment' then
  if tg_op='UPDATE' and new.entity in ('employees','resources','resource-memberships','tasks','jobs') then
   perform 1 from lms.organizations where id=new.organization_id for update;
   insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
   if new.entity='resources' and new.data->>'kind' not in ('Worker','Crew') and exists(select 1 from lms.equipment_checkouts where organization_id=new.organization_id and resource_id=new.id and returned_at is null) then raise exception 'Return equipment before changing its assigned crew/worker type' using errcode='23514';end if;
   if new.entity='resource-memberships' and exists(select 1 from lms.equipment_checkouts c where c.organization_id=new.organization_id and c.membership_id=new.id and c.returned_at is null and ((new.data->>'start')::timestamptz>c.checked_out_at or (new.data->>'end')::timestamptz<=c.checked_out_at)) then raise exception 'Active checkout retains its reviewed effective crew membership' using errcode='23514';end if;
  end if;
  if tg_op='UPDATE' and (new.archived or (new.entity='employees' and new.data->>'status'<>'Active')) and exists(select 1 from lms.equipment_checkouts c where c.organization_id=new.organization_id and c.returned_at is null and new.id in (c.employee_id,c.resource_id,c.work_id,c.membership_id)) then raise exception 'Return active equipment before disabling an assigned employee/crew/work/membership' using errcode='23514';end if;
  if tg_op='UPDATE' and new.archived and exists(select 1 from lms.equipment_state held_state where held_state.organization_id=new.organization_id and held_state.work_id=new.id and held_state.condition<>'Retired' and held_state.maintenance in ('Task opened','Service recorded')) then raise exception 'Retain the active equipment maintenance task until review is complete' using errcode='23514';end if;
  return new;
 end if;
 perform 1 from lms.organizations where id=new.organization_id for update;
 insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 select * into s from lms.equipment_state where organization_id=new.organization_id and record_id=new.id;
 select max(revision) into cfg from lms.config_revisions where organization_id=new.organization_id;
 if new.archived or new.config_revision<>cfg then raise exception 'Equipment cannot be archived; review current configuration or explicitly retire it' using errcode='23514';end if;
 if tg_op='UPDATE' and (s.revision is distinct from old.revision or s.condition='Retired') then raise exception 'Equipment state changed, is missing or permanently retired' using errcode='23514';end if;
 if req is not null then
  if tg_op<>'UPDATE' or new.data is distinct from old.data or nullif(current_setting('lms.equipment_operation',true),'') is null then raise exception 'Equipment lifecycle commands retain catalog metadata' using errcode='23514';end if;
  perform lms_private.equipment_transition(new.organization_id,req,old,s);
 else
  perform lms_private.equipment_operator(new.organization_id,'metadata');
  if command is null or command->'request'->>'kind'<>'save' or command->'request'->>'entity'<>'equipment' or command->>'operationId' is null then raise exception 'Equipment registry changes require a reviewed record command and operation ID' using errcode='23514';end if;
  if tg_op='UPDATE' and upper(new.data->>'asset_id') is distinct from upper(old.data->>'asset_id') then raise exception 'Business equipment IDs are permanent; history retains their identity' using errcode='23514';end if;
 end if;
 if jsonb_typeof(new.data->'name') is distinct from 'string' or nullif(btrim(new.data->>'name'),'') is null or coalesce(new.data->>'asset_id','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' or new.data->>'location' is null then raise exception 'Equipment requires a name, permanent business ID and scoped storage location' using errcode='23514';end if;
 for k,v in select * from jsonb_each(new.data) loop
  if k not in ('name','asset_id','category','description','manufacturer','model','serial','barcode','purchased_on','purchase_cost','location','notes') or jsonb_typeof(v)<>'string' or length(v#>>'{}')>(case when k in ('description','notes') then 2000 else 200 end) then raise exception 'Invalid equipment metadata field' using errcode='23514';end if;
 end loop;
 if nullif(new.data->>'barcode','') is not null and new.data->>'barcode' !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/+\-]{0,79}$' then raise exception 'Invalid equipment barcode/asset tag' using errcode='23514';end if;
 if nullif(new.data->>'purchase_cost','') is not null and new.data->>'purchase_cost' !~ '^(0|[1-9]\d{0,11})$' then raise exception 'Optional non-accounting purchase cost uses exact USD minor units' using errcode='23514';end if;
 if nullif(new.data->>'purchased_on','') is not null then d:=(new.data->>'purchased_on')::date;if d not between date '1900-01-01' and date '2100-12-31' or to_char(d,'YYYY-MM-DD')<>new.data->>'purchased_on' then raise exception 'Invalid equipment purchase date' using errcode='23514';end if;end if;
 return new;
end; $$;
create trigger record_equipment_guard before insert or update on lms.records for each row execute function lms_private.equipment_guard();
create function lms_private.equipment_projection() returns trigger language plpgsql security definer set search_path='' as $$
declare req jsonb:=nullif(current_setting('lms.equipment_command',true),'')::jsonb;cmd jsonb:=nullif(current_setting('lms.record_command',true),'')::jsonb;s lms.equipment_state;co lms.equipment_checkouts;next_data jsonb;outcome jsonb;op uuid;action text;notes text;
begin
 if new.entity<>'equipment' then return new;end if;
 select * into s from lms.equipment_state where organization_id=new.organization_id and record_id=new.id;
 if req is null then
  op:=(cmd->>'operationId')::uuid;action:=case when tg_op='INSERT' then 'Register' else 'Edit' end;notes:='Explicit equipment registry revision';
  if tg_op='INSERT' then insert into lms.equipment_state values(new.organization_id,new.id,new.revision,upper(new.data->>'asset_id'),nullif(upper(btrim(new.data->>'barcode')),''),'Needs inspection','Initial inspection',null,null,null,null) returning * into s;
  else update lms.equipment_state set revision=new.revision,barcode_key=nullif(upper(btrim(new.data->>'barcode')),'') where organization_id=new.organization_id and record_id=new.id returning * into s;end if;
  select * into co from lms.equipment_checkouts where organization_id=new.organization_id and equipment_id=new.id and returned_at is null;
 else
  op:=current_setting('lms.equipment_operation')::uuid;action:=req->>'kind';notes:=btrim(req->>'notes');
  outcome:=lms_private.equipment_transition(new.organization_id,req,old,s);next_data:=outcome->'state';
  update lms.equipment_state set revision=new.revision,condition=next_data->>'condition',maintenance=next_data->>'maintenance',work_id=(next_data->>'work_id')::uuid,technician_id=(next_data->>'technician_id')::uuid,last_service=(next_data->>'last_service')::date,next_inspection=(next_data->>'next_inspection')::date where organization_id=new.organization_id and record_id=new.id returning * into s;
  if action='checkout' then
   insert into lms.equipment_checkouts(organization_id,equipment_id,revision,employee_id,employee_revision,resource_id,membership_id,membership_revision,work_id,checked_out_at,expected_return_at,status,checked_out_by)
   select new.organization_id,new.id,1,(j->>'employee_id')::uuid,(j->>'employee_revision')::integer,(j->>'resource_id')::uuid,(j->>'membership_id')::uuid,(j->>'membership_revision')::integer,(j->>'work_id')::uuid,(j->>'checked_out_at')::timestamptz,(j->>'expected_return_at')::timestamptz,'Checked out',lms.current_user_id() from (select outcome->'checkout' j)t returning * into co;
  elsif action in ('return','begin-use') then
   update lms.equipment_checkouts set revision=revision+1,status=case when action='return' then 'Returned' else 'In use' end,returned_at=case when action='return' then (outcome->'checkout'->>'returned_at')::timestamptz else null end,return_condition=case when action='return' then outcome->'checkout'->>'return_condition' else null end,returned_by=case when action='return' then lms.current_user_id() else null end where organization_id=new.organization_id and id=(req->>'checkoutId')::uuid and revision=(req->>'checkoutRevision')::integer and returned_at is null returning * into co;
   if co.id is null then raise exception 'Equipment checkout changed' using errcode='23514';end if;
  elsif action='report-problem' then
   update lms.equipment_checkouts set revision=revision+1,status='Checked out' where organization_id=new.organization_id and equipment_id=new.id and returned_at is null and status='In use' returning * into co;
   if co.id is null then select * into co from lms.equipment_checkouts where organization_id=new.organization_id and equipment_id=new.id and returned_at is null;end if;
  else select * into co from lms.equipment_checkouts where organization_id=new.organization_id and equipment_id=new.id and returned_at is null;end if;
  insert into lms.record_operations values(new.organization_id,op,lms.current_user_id(),new.id,jsonb_build_object('kind','equipment-command','input',req),to_jsonb(new));
 end if;
 insert into lms.equipment_events values(new.organization_id,new.id,new.revision,new.config_revision,action,new.data,to_jsonb(s),case when co.id is null then null else to_jsonb(co) end,notes,lms.current_user_id(),op,now());
 return new;
end; $$;
create trigger record_equipment_projection after insert or update on lms.records for each row execute function lms_private.equipment_projection();
create function lms.write_equipment(org uuid,operation uuid,req jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt lms.record_operations;prior lms.records;s lms.equipment_state;result lms.records;cfg integer;
begin
 if operation is null then raise exception 'Equipment actions require an operation ID' using errcode='23514';end if;
 perform 1 from lms.organizations where id=org for update;
 perform lms_private.equipment_operator(org,req->>'kind');
 insert into lms_private.record_epochs(organization_id,epoch) values(org,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 select * into receipt from lms.record_operations where organization_id=org and operation_id=operation;
 if found then if receipt.actor_id is distinct from lms.current_user_id() or receipt.request is distinct from jsonb_build_object('kind','equipment-command','input',req) then raise exception 'Operation ID belongs to another actor/request' using errcode='23514';end if;return receipt.result;end if;
 select * into prior from lms.records where organization_id=org and id=(req->>'equipmentId')::uuid and entity='equipment' for update;
 select * into s from lms.equipment_state where organization_id=org and record_id=prior.id;
 perform lms_private.equipment_transition(org,req,prior,s);
 select max(revision) into cfg from lms.config_revisions where organization_id=org;
 perform set_config('lms.record_command','',true);perform set_config('lms.equipment_command',req::text,true);perform set_config('lms.equipment_operation',operation::text,true);
 update lms.records set data=data,config_revision=cfg where organization_id=org and id=prior.id returning * into result;
 perform set_config('lms.equipment_command','',true);perform set_config('lms.equipment_operation','',true);
 return to_jsonb(result);
end; $$;
revoke all on function lms_private.equipment_operator(uuid,text),lms_private.equipment_history_guard(),lms_private.equipment_instant(text),lms_private.equipment_date(text),lms_private.equipment_reference(uuid,uuid,integer,text[]),lms_private.equipment_transition(uuid,jsonb,lms.records,lms.equipment_state),lms_private.equipment_guard(),lms_private.equipment_projection() from public,lms_app;
revoke all on function lms.write_equipment(uuid,uuid,jsonb) from public;
grant execute on function lms.write_equipment(uuid,uuid,jsonb) to lms_app;
