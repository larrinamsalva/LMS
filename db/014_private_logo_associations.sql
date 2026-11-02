-- Additive host-only fictional association contract. No portable formats or old SQL are changed.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then
  raise exception 'Stop runtime hosts before private association migration' using errcode='55000';
 end if;
end; $$;
lock table lms.organizations in share row exclusive mode nowait;

create table lms.logo_association_states (
 organization_id uuid primary key references lms.organizations(id) on delete cascade,
 revision integer not null default 0 check(revision between 0 and 129)
);
-- A real cursor exists BEFORE any first binding. Row locks can then reject old snapshots
-- even when a transaction predates the first association (an absent-row check cannot).
insert into lms.logo_association_states(organization_id) select id from lms.organizations;
create function lms_private.logo_association_initialize() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into lms.logo_association_states(organization_id) values(new.id);
 return new;
end; $$;
create trigger logo_association_initialize after insert on lms.organizations for each row execute function lms_private.logo_association_initialize();
revoke all on function lms_private.logo_association_initialize() from public,lms_app,lms_auth_service;
-- Preserve existing whole-host EMPTY sandbox retirement. A cursor cannot be deleted
-- independently, or after any association. Asset/history foreign keys never cascade.
create function lms_private.logo_association_cursor_retention() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.revision<>0 or exists(select 1 from lms.organizations where id=old.organization_id) then
  raise exception 'Retain association cursor and history; only an empty parent sandbox can retire' using errcode='23514';
 end if;
 return old;
end; $$;
create trigger logo_association_cursor_retention before delete on lms.logo_association_states for each row execute function lms_private.logo_association_cursor_retention();
revoke all on function lms_private.logo_association_cursor_retention() from public,lms_app,lms_auth_service;
create table lms.logo_association_receipts (
 organization_id uuid not null references lms.organizations(id), operation_id uuid not null,
 actor_id uuid not null references lms.users(id), request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 result jsonb not null, occurred_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,operation_id)
);
create table lms.logo_associations (
 organization_id uuid not null, revision integer not null check(revision between 1 and 129),
 configuration_revision integer not null, configuration_sha256 text not null check(configuration_sha256 ~ '^[a-f0-9]{64}$'),
 mode text not null check(mode in ('image','builtin')), asset_id uuid, asset_revision integer,
 asset_sha256 text, display text, restored_from integer,
 actor_id uuid not null references lms.users(id), operation_id uuid not null,
 occurred_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,revision), unique(organization_id,operation_id),
 foreign key(organization_id,configuration_revision) references lms.config_revisions(organization_id,revision),
 foreign key(organization_id,asset_id,asset_revision) references lms.logo_asset_history(organization_id,asset_id,revision),
 foreign key(organization_id,restored_from) references lms.logo_associations(organization_id,revision),
 foreign key(organization_id,operation_id) references lms.logo_association_receipts(organization_id,operation_id) deferrable initially deferred,
 check((mode='image' and asset_id is not null and asset_revision is not null and asset_sha256 is not null and asset_sha256 ~ '^[a-f0-9]{64}$' and display is not null and display in ('square','rectangle'))
    or (mode='builtin' and asset_id is null and asset_revision is null and asset_sha256 is null and display is null and restored_from is null))
);
create index logo_association_asset_references on lms.logo_associations(organization_id,asset_id);
alter table lms.logo_association_states enable row level security;
alter table lms.logo_association_states force row level security;
alter table lms.logo_association_receipts enable row level security;
alter table lms.logo_association_receipts force row level security;
alter table lms.logo_associations enable row level security;
alter table lms.logo_associations force row level security;
create policy logo_association_states_read on lms.logo_association_states for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy logo_associations_read on lms.logo_associations for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
create policy logo_association_receipts_read on lms.logo_association_receipts for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
revoke all on lms.logo_association_states,lms.logo_associations,lms.logo_association_receipts from public,lms_app,lms_auth_service;
grant select on lms.logo_association_states,lms.logo_associations,lms.logo_association_receipts to lms_app;
create trigger logo_associations_immutable before update or delete on lms.logo_associations for each row execute function lms_private.logo_immutable();
create trigger logo_association_receipts_immutable before update or delete on lms.logo_association_receipts for each row execute function lms_private.logo_immutable();

-- Every publication, including direct restricted SQL, serializes before the existing record-epoch guard.
-- PostgreSQL runs same-kind triggers alphabetically. This avoids an epoch->organization lock inversion.
create function lms_private.logo_configuration_fence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from lms.organizations where id=new.organization_id for update;
 if not found then raise exception 'Configuration organization unavailable' using errcode='23503';end if;
 return new;
end; $$;
create trigger config_00_private_logo_fence before insert on lms.config_revisions for each row execute function lms_private.logo_configuration_fence();

-- Retention labels never erase a historical association reference. Physical purging remains unsupported.
create function lms_private.logo_reference_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='retired' then
  -- Organization lock is already held by the existing asset command. This real cursor
  -- fence detects even a first binding committed after a REPEATABLE READ snapshot.
  perform 1 from lms.logo_association_states where organization_id=old.organization_id for share;
  if not found then raise exception 'Association reference cursor unavailable; refuse retirement' using errcode='23514';end if;
  if exists(select 1 from lms.logo_associations where organization_id=old.organization_id and asset_id=old.id) then
   raise exception 'Historical branding references require retained bytes; retirement is unsupported' using errcode='23514';
  end if;
 end if;
 return new;
end; $$;
create trigger logo_reference_guard before update on lms.logo_assets for each row execute function lms_private.logo_reference_guard();

create function lms_private.logo_association_document(a lms.logo_associations) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('format','lms-private-logo-association','version',1,'organizationId',a.organization_id,'revision',a.revision,
 'configurationRevision',a.configuration_revision,'configurationSha256',a.configuration_sha256,'mode',a.mode,
 'asset',case when a.asset_id is not null then jsonb_build_object('id',a.asset_id,'revision',a.asset_revision,'sha256',a.asset_sha256) end,
 'display',a.display,'actorId',a.actor_id,'operationId',a.operation_id,'restoredFrom',a.restored_from,
 'occurredAt',to_char(a.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create function lms_private.logo_association_inspect(org uuid,instance uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c lms.config_revisions; a lms.logo_associations; p lms.logo_assets; status text; digest text; cursor_revision integer;
begin
 perform lms_private.logo_authorize(org,instance,false);
 -- Existing publication/record epochs reject stale repeatable-read snapshots without a second decision engine.
 perform 1 from lms_private.record_epochs where organization_id=org for share;
 if not found then raise exception 'Published configuration epoch unavailable' using errcode='55000';end if;
 select * into c from lms.config_revisions where organization_id=org order by revision desc limit 1;
 if not found then raise exception 'Published configuration unavailable' using errcode='55000';end if;
 digest:=encode(sha256(convert_to(c.document::text,'UTF8')),'hex');
 select * into a from lms.logo_associations where organization_id=org order by revision desc limit 1;
 select revision into cursor_revision from lms.logo_association_states where organization_id=org for share;
 if not found then raise exception 'Association reference cursor unavailable' using errcode='23514';end if;
 if coalesce(a.revision,0)<>coalesce(cursor_revision,0) then raise exception 'Association history is inconsistent; inspect privately' using errcode='23514';end if;
 if c.document->>'schemaVersion'<>'2' then status:='unbranded';
 elsif a.revision is null or a.mode='builtin' then status:='builtin';
 elsif a.configuration_revision<>c.revision or a.configuration_sha256<>digest then status:='configuration-changed';
 else
  select * into p from lms.logo_assets where organization_id=org and id=a.asset_id for share;
  if not found or p.state in ('blocked','retired') or p.revision<a.asset_revision or p.sha256<>a.asset_sha256
   or not exists(select 1 from lms.logo_asset_history where organization_id=org and asset_id=a.asset_id and revision=a.asset_revision and state='selected')
   or not lms_private.valid_logo_png(p.content) or p.bytes<>octet_length(p.content) or p.sha256<>encode(sha256(p.content),'hex') then status:='asset-unavailable';
  else status:='active';end if;
 end if;
 return jsonb_build_object('version',1,'organizationId',org,'configurationRevision',c.revision,'configurationSha256',digest,
  'configuration',c.document,'revision',coalesce(a.revision,0),'status',status,
  'association',case when a.revision is not null then lms_private.logo_association_document(a) end);
end; $$;

create function lms_private.logo_association_review(org uuid,instance uuid,mode text,layout text,previous integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare c lms.config_revisions; s lms.logo_asset_states; p lms.logo_assets; old lms.logo_associations; current_revision integer;
begin
 perform lms_private.logo_authorize(org,instance,true);
 perform 1 from lms_private.record_epochs where organization_id=org for share;
 if not found then raise exception 'Published configuration epoch unavailable' using errcode='55000';end if;
 if mode is null or mode not in ('image','builtin') then raise exception 'Review an image or built-in mark' using errcode='23514';end if;
 select * into c from lms.config_revisions where organization_id=org order by revision desc limit 1;
 if not found then raise exception 'Published configuration unavailable' using errcode='55000';end if;
 select revision into current_revision from lms.logo_association_states where organization_id=org for share;
 if not found then raise exception 'Association reference cursor unavailable' using errcode='23514';end if;
 select * into s from lms.logo_asset_states where organization_id=org for share;
 if mode='image' then
  if c.document->>'schemaVersion'<>'2' or not lms_private.valid_branding_configuration(c.document) then
   raise exception 'A reviewed branded configuration is required; no automatic version upgrade' using errcode='23514';end if;
  if layout is null or layout not in ('square','rectangle') then raise exception 'Use a reviewed contained layout' using errcode='23514';end if;
  select * into p from lms.logo_assets where organization_id=org and id=s.asset_id for share;
  if not found or p.state<>'selected' or not lms_private.valid_logo_png(p.content) or p.sha256<>encode(sha256(p.content),'hex') or p.bytes<>octet_length(p.content) then
   raise exception 'Select and inspect a valid retained organization-owned image first' using errcode='23514';end if;
  if previous is not null then
   select h.* into old from lms.logo_associations h where h.organization_id=org and h.revision=previous and h.mode='image';
   if not found or old.asset_id<>p.id or old.asset_sha256<>p.sha256 then raise exception 'Select the retained historical image before reviewing restoration' using errcode='23514';end if;
  end if;
 elsif layout is not null or previous is not null then raise exception 'Built-in fallback has no asset or historical restoration' using errcode='23514';
 end if;
 return jsonb_build_object('format','lms-private-logo-association-review','version',1,'organizationId',org,'actorId',lms.current_user_id(),
 'configurationRevision',c.revision,'configurationSha256',encode(sha256(convert_to(c.document::text,'UTF8')),'hex'),
 'assetStateRevision',coalesce(s.revision,0),'associationRevision',coalesce(current_revision,0),'mode',mode,
 'asset',case when mode='image' then jsonb_build_object('id',p.id,'revision',p.revision,'sha256',p.sha256) end,
 'display',layout,'historyRevision',previous);
end; $$;

create function lms_private.logo_association_operation(org uuid,instance uuid,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare review jsonb:=command->'review'; fresh jsonb; op uuid; actor uuid:=lms.current_user_id(); request_digest text;
 prior lms.logo_association_receipts; cursor_row lms.logo_association_states; a lms.logo_associations; n integer;
begin
 perform lms_private.logo_authorize(org,instance,true);
 if command is null or jsonb_typeof(command)<>'object' or octet_length(command::text)>8192 or command->>'format' is distinct from 'lms-private-logo-association-command'
  or command->'version' is distinct from '1'::jsonb or command->'confirmed' is distinct from 'true'::jsonb
  or command->>'operationId' is null or exists(select 1 from jsonb_object_keys(command)k where k not in ('format','version','operationId','review','confirmed'))
  or review is null or jsonb_typeof(review)<>'object' then raise exception 'Use the versioned explicit association confirmation' using errcode='23514';end if;
 op:=(command->>'operationId')::uuid;
 request_digest:=encode(sha256(convert_to(command::text,'UTF8')),'hex');
 select * into prior from lms.logo_association_receipts where organization_id=org and operation_id=op;
 if found then
  if prior.actor_id<>actor or prior.request_digest<>request_digest then raise exception 'Association retry conflicts with original operation' using errcode='40001';end if;
  return prior.result;
 end if;
 -- Reconstruct all facts using existing authority, selection, configuration and instance controls. No review token grants authority.
 fresh:=lms_private.logo_association_review(org,instance,review->>'mode',review->>'display',(review->>'historyRevision')::integer);
 if review is distinct from fresh then raise exception 'Association review is stale or mismatched; explicitly refresh' using errcode='40001';end if;
 select * into strict cursor_row from lms.logo_association_states where organization_id=org for update;
 if cursor_row.revision<>(review->>'associationRevision')::integer then raise exception 'Association revision changed' using errcode='40001';end if;
 select count(*) into n from lms.logo_associations where organization_id=org;
 if n>=128 and (n>=129 or review->>'mode'<>'builtin') then raise exception 'Association review budget exhausted; built-in fallback reserved' using errcode='23514';end if;
 if review->>'mode'='builtin' and not exists(select 1 from lms.logo_associations where organization_id=org and revision=cursor_row.revision and mode='image') then
  raise exception 'No image association needs reverting' using errcode='23514';end if;
 insert into lms.logo_associations(organization_id,revision,configuration_revision,configuration_sha256,mode,asset_id,asset_revision,asset_sha256,display,restored_from,actor_id,operation_id)
 values(org,cursor_row.revision+1,(review->>'configurationRevision')::integer,review->>'configurationSha256',review->>'mode',
 (review->'asset'->>'id')::uuid,(review->'asset'->>'revision')::integer,review->'asset'->>'sha256',review->>'display',(review->>'historyRevision')::integer,actor,op) returning * into a;
 update lms.logo_association_states set revision=a.revision where organization_id=org;
 insert into lms.logo_association_receipts(organization_id,operation_id,actor_id,request_digest,result) values(org,op,actor,request_digest,lms_private.logo_association_document(a));
 -- Reuse the existing immutable audit table; no PNG content, digest, configuration document or private image values.
 insert into lms.audit_events(organization_id,actor_id,entity,action,after_data)
 values(org,actor,'private-logo-association','associate',jsonb_build_object('version',1,'revision',a.revision,'configurationRevision',a.configuration_revision,'mode',a.mode,'operationId',op));
 return lms_private.logo_association_document(a);
end; $$;

create function lms_private.logo_association_history(org uuid,instance uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform lms_private.logo_authorize(org,instance,true);
 return (select coalesce(jsonb_agg(lms_private.logo_association_document(a) order by revision),'[]'::jsonb) from lms.logo_associations a where organization_id=org);
end; $$;
create function lms_private.logo_association_read(org uuid,instance uuid,expected integer,configuration integer) returns table(image bytea,metadata jsonb) language plpgsql security definer set search_path='' as $$
declare inspected jsonb; a lms.logo_assets;
begin
 inspected:=lms_private.logo_association_inspect(org,instance);
 if expected is null or configuration is null or inspected->>'status'<>'active' or (inspected->>'revision')::integer<>expected or (inspected->>'configurationRevision')::integer<>configuration then
  raise exception 'Associated logo unavailable or configuration changed; use built-in fallback' using errcode='40001';end if;
 select * into strict a from lms.logo_assets where organization_id=org and id=(inspected->'association'->'asset'->>'id')::uuid;
 return query select a.content,lms_private.logo_metadata(a);
end; $$;

revoke all on function lms_private.logo_configuration_fence(),lms_private.logo_reference_guard(),lms_private.logo_association_document(lms.logo_associations) from public,lms_app,lms_auth_service;
revoke all on function lms_private.logo_association_inspect(uuid,uuid),lms_private.logo_association_review(uuid,uuid,text,text,integer),lms_private.logo_association_operation(uuid,uuid,jsonb),lms_private.logo_association_history(uuid,uuid),lms_private.logo_association_read(uuid,uuid,integer,integer) from public,lms_auth_service;
grant execute on function lms_private.logo_association_inspect(uuid,uuid),lms_private.logo_association_review(uuid,uuid,text,text,integer),lms_private.logo_association_operation(uuid,uuid,jsonb),lms_private.logo_association_history(uuid,uuid),lms_private.logo_association_read(uuid,uuid,integer,integer) to lms_app;
create function lms.logo_association_inspect(org uuid,instance uuid) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_association_inspect(org,instance);$$;
create function lms.logo_association_review(org uuid,instance uuid,mode text,layout text,previous integer) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_association_review(org,instance,mode,layout,previous);$$;
create function lms.logo_association_operation(org uuid,instance uuid,command jsonb) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_association_operation(org,instance,command);$$;
create function lms.logo_association_history(org uuid,instance uuid) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_association_history(org,instance);$$;
create function lms.logo_association_read(org uuid,instance uuid,expected integer,configuration integer) returns table(image bytea,metadata jsonb) language sql security invoker set search_path='' as $$select * from lms_private.logo_association_read(org,instance,expected,configuration);$$;
revoke all on function lms.logo_association_inspect(uuid,uuid),lms.logo_association_review(uuid,uuid,text,text,integer),lms.logo_association_operation(uuid,uuid,jsonb),lms.logo_association_history(uuid,uuid),lms.logo_association_read(uuid,uuid,integer,integer) from public,lms_auth_service;
grant execute on function lms.logo_association_inspect(uuid,uuid),lms.logo_association_review(uuid,uuid,text,text,integer),lms.logo_association_operation(uuid,uuid,jsonb),lms.logo_association_history(uuid,uuid),lms.logo_association_read(uuid,uuid,integer,integer) to lms_app;
