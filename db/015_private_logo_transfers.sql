-- Additive host-only fictional transfer. Portable protocols and SQL 1-14 are unchanged.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then
  raise exception 'Stop runtime hosts before private transfer migration' using errcode='55000';
 end if;
end; $$;

create table lms.logo_transfer_receipts (
 organization_id uuid not null references lms.organizations(id), operation_id uuid not null,
 actor_id uuid not null references lms.users(id), instance_id uuid not null,
 configuration_revision integer not null, asset_id uuid not null, asset_revision integer not null check(asset_revision=1),
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'), result jsonb not null,
 occurred_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,operation_id), unique(organization_id,asset_id),
 foreign key(organization_id,configuration_revision) references lms.config_revisions(organization_id,revision),
 foreign key(organization_id,asset_id,asset_revision) references lms.logo_asset_history(organization_id,asset_id,revision),
 foreign key(organization_id,operation_id) references lms.logo_asset_receipts(organization_id,operation_id)
);
alter table lms.logo_transfer_receipts enable row level security;
alter table lms.logo_transfer_receipts force row level security;
create policy logo_transfers_read on lms.logo_transfer_receipts for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
revoke all on lms.logo_transfer_receipts from public,lms_app,lms_auth_service;
grant select on lms.logo_transfer_receipts to lms_app;
create trigger logo_transfer_receipts_immutable before update or delete on lms.logo_transfer_receipts for each row execute function lms_private.logo_immutable();

-- Closed metadata vocabulary, not another ZIP validator or native image decoder.
create function lms_private.logo_transfer_source_valid(s jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text; maximum integer;
begin
 if s is null or jsonb_typeof(s)<>'object' or exists(select 1 from jsonb_object_keys(s) as fields(key) where fields.key not in
 ('bundleVersion','bundleSha256','bundleBytes','blueprintVersion','blueprintSha256','blueprintBytes','buildPlanVersion','configurationSchema','companionVersion','companionSha256','companionBytes','imageSha256','imageBytes','imageWidth','imageHeight','display')) then return false;end if;
 if s->'bundleVersion' is distinct from '1'::jsonb or s->'companionVersion' is distinct from '1'::jsonb
  or s->'blueprintVersion' is null or s->'blueprintVersion' not in ('1'::jsonb,'2'::jsonb)
  or s->'buildPlanVersion' is distinct from s->'blueprintVersion' or s->'configurationSchema' is distinct from s->'blueprintVersion'
  or coalesce(s->>'display','') not in ('square','rectangle') then return false;end if;
 foreach k in array array['bundleSha256','blueprintSha256','companionSha256','imageSha256'] loop
  if jsonb_typeof(s->k) is distinct from 'string' or coalesce(s->>k,'') !~ '^[a-f0-9]{64}$' then return false;end if;
 end loop;
 for k,maximum in select * from (values('bundleBytes',393216),('blueprintBytes',98304),('companionBytes',266240),('imageBytes',262144),('imageWidth',512),('imageHeight',512)) bounds loop
  if jsonb_typeof(s->k) is distinct from 'number' or coalesce(s->>k,'') !~ '^[1-9][0-9]{0,5}$' then return false;end if;
  if (s->>k)::integer>maximum then return false;end if;
 end loop;
 return true;
end; $$;

-- Same organization-first locking order as publication, assets and ownership. Reuse
-- the shared recent-session rule/row lock: expiry and revocation are checked through commit.
create function lms_private.logo_transfer_state(org uuid,instance uuid,sid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c lms.config_revisions; ar integer; sr integer;
begin
 perform lms_private.logo_authorize(org,instance,true);
 perform lms_private.require_access_session(sid);
 perform 1 from lms_private.record_epochs where organization_id=org for share;
 if not found then raise exception 'Published configuration epoch unavailable' using errcode='55000';end if;
 select revision into ar from lms.logo_association_states where organization_id=org for share;
 if not found then raise exception 'Association cursor unavailable' using errcode='23514';end if;
 select revision into sr from lms.logo_asset_states where organization_id=org for share;
 select * into c from lms.config_revisions where organization_id=org order by revision desc limit 1;
 if not found then raise exception 'Published configuration unavailable' using errcode='55000';end if;
 return jsonb_build_object('configuration',c.document,'expected',jsonb_build_object('configurationRevision',c.revision,
  'configurationSha256',encode(sha256(convert_to(c.document::text,'UTF8')),'hex'),'assetStateRevision',coalesce(sr,0),'associationRevision',ar),
  'usage',jsonb_build_object('assets',(select count(*) from lms.logo_assets where organization_id=org),
  'bytes',(select coalesce(sum(bytes),0) from lms.logo_assets where organization_id=org),
  'operations',(select count(*) from lms.logo_asset_receipts where organization_id=org)));
end; $$;
create function lms_private.logo_transfer_review(org uuid,instance uuid,sid uuid,source jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare state jsonb; at timestamptz:=clock_timestamp();
begin
 state:=lms_private.logo_transfer_state(org,instance,sid);
 if not lms_private.logo_transfer_source_valid(source) then raise exception 'Invalid reviewed bundle commitments' using errcode='23514';end if;
 return jsonb_build_object('format','lms-private-logo-transfer-review','version',1,'organizationId',org,'instanceId',instance,'actorId',lms.current_user_id(),
 'source',source,'expected',state->'expected','sanitizer','sharp-0.35.5/png-v1',
 'reviewedAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'expiresAt',to_char((at+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end; $$;

create function lms_private.logo_transfer_operation(org uuid,instance uuid,sid uuid,command jsonb,png bytea) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb:=command->'review'; fresh jsonb; op uuid; actor uuid:=lms.current_user_id(); fingerprint text;
 prior lms.logo_transfer_receipts; a lms.logo_assets; stored jsonb; result jsonb; at timestamptz;
begin
 perform lms_private.logo_authorize(org,instance,true);
 perform lms_private.require_access_session(sid);
 if command is null or jsonb_typeof(command)<>'object' or octet_length(command::text)>8192
  or command->>'format' is distinct from 'lms-private-logo-transfer-command' or command->'version' is distinct from '1'::jsonb
  or command->'confirmed' is distinct from 'true'::jsonb or command->>'operationId' is null
  or exists(select 1 from jsonb_object_keys(command)k where k not in ('format','version','operationId','review','confirmed'))
  or r is null or jsonb_typeof(r)<>'object' then raise exception 'Use the versioned explicit transfer approval' using errcode='23514';end if;
 op:=(command->>'operationId')::uuid;
 fingerprint:=encode(sha256(convert_to(command::text,'UTF8')),'hex');
 select * into prior from lms.logo_transfer_receipts where organization_id=org and operation_id=op;
 if found then
  if prior.actor_id<>actor or prior.instance_id<>instance or prior.request_digest<>fingerprint
   or (png is not null and encode(sha256(png),'hex') is distinct from prior.result->'asset'->>'sha256') then
   raise exception 'Transfer retry conflicts with the committed operation' using errcode='40001';end if;
  return prior.result; -- Historical receipt, not proof of present image availability/selection.
 end if;
 if exists(select 1 from lms.logo_asset_receipts where organization_id=org and operation_id=op) then
  raise exception 'Operation already belongs to a different asset command' using errcode='40001';end if;
 -- Reconstruct authority and ALL current revisions; a host review packet is not an authorization token.
 fresh:=lms_private.logo_transfer_review(org,instance,sid,r->'source');
 if (r-array['reviewedAt','expiresAt']) is distinct from (fresh-array['reviewedAt','expiresAt']) then
  raise exception 'Transfer review is stale, foreign or mismatched; explicitly refresh' using errcode='40001';end if;
 if jsonb_typeof(r->'reviewedAt') is distinct from 'string' or jsonb_typeof(r->'expiresAt') is distinct from 'string'
  or (r->>'reviewedAt')::timestamptz>clock_timestamp() or (r->>'expiresAt')::timestamptz<=clock_timestamp()
  or (r->>'expiresAt')::timestamptz-(r->>'reviewedAt')::timestamptz<>interval '10 minutes' then
  raise exception 'Transfer review expired or has unsupported timing; explicitly refresh' using errcode='40001';end if;
 if not lms_private.valid_logo_png(png) then raise exception 'Re-sanitize the image with the approved host processor' using errcode='23514';end if;
 -- Reuse the existing storage, UUID, quota, cursor, lifecycle, history and receipt command in this transaction.
 stored:=lms_private.logo_operation(org,instance,jsonb_build_object('version',1,'operationId',op,'action','store',
  'expectedRevision',r->'expected'->'assetStateRevision','display',r->'source'->'display','inputSha256',r->'source'->'imageSha256'),png);
 select * into strict a from lms.logo_assets where organization_id=org and id=(stored->>'assetId')::uuid;
 if a.revision<>1 or a.state<>'stored' or a.sanitizer<>'sharp-0.35.5/png-v1'
  or a.width<>(r->'source'->>'imageWidth')::integer or a.height<>(r->'source'->>'imageHeight')::integer then
  raise exception 'Destination output profile or dimensions differ from reviewed image' using errcode='23514';end if;
 at:=clock_timestamp();
 result:=jsonb_build_object('format','lms-private-logo-destination-map','version',1,'operationId',op,'reviewStatus','confirmed','review',r,
  'asset',jsonb_build_object('id',a.id,'revision',a.revision,'state',a.state,'sha256',a.sha256,'bytes',a.bytes,'width',a.width,'height',a.height,'sanitizer',a.sanitizer),
  'assetStateRevision',stored->'revision','occurredAt',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 insert into lms.logo_transfer_receipts(organization_id,operation_id,actor_id,instance_id,configuration_revision,asset_id,asset_revision,request_digest,result,occurred_at)
 values(org,op,actor,instance,(r->'expected'->>'configurationRevision')::integer,a.id,1,fingerprint,result,at);
 insert into lms.audit_events(organization_id,actor_id,entity,action,after_data)
 values(org,actor,'private-logo-transfer','store',jsonb_build_object('version',1,'operationId',op,'configurationRevision',r->'expected'->'configurationRevision','assetStateRevision',stored->'revision'));
 return result;
end; $$;
create function lms_private.logo_transfer_history(org uuid,instance uuid,sid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform lms_private.logo_authorize(org,instance,true);
 perform lms_private.require_access_session(sid);
 return (select coalesce(jsonb_agg(result order by occurred_at,operation_id),'[]'::jsonb) from lms.logo_transfer_receipts where organization_id=org);
end; $$;

revoke all on function lms_private.logo_transfer_source_valid(jsonb) from public,lms_app,lms_auth_service;
revoke all on function lms_private.logo_transfer_state(uuid,uuid,uuid),lms_private.logo_transfer_review(uuid,uuid,uuid,jsonb),lms_private.logo_transfer_operation(uuid,uuid,uuid,jsonb,bytea),lms_private.logo_transfer_history(uuid,uuid,uuid) from public,lms_auth_service;
grant execute on function lms_private.logo_transfer_state(uuid,uuid,uuid),lms_private.logo_transfer_review(uuid,uuid,uuid,jsonb),lms_private.logo_transfer_operation(uuid,uuid,uuid,jsonb,bytea),lms_private.logo_transfer_history(uuid,uuid,uuid) to lms_app;
create function lms.logo_transfer_state(org uuid,instance uuid,sid uuid) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_transfer_state(org,instance,sid);$$;
create function lms.logo_transfer_review(org uuid,instance uuid,sid uuid,source jsonb) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_transfer_review(org,instance,sid,source);$$;
create function lms.logo_transfer_operation(org uuid,instance uuid,sid uuid,command jsonb,png bytea) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_transfer_operation(org,instance,sid,command,png);$$;
create function lms.logo_transfer_history(org uuid,instance uuid,sid uuid) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_transfer_history(org,instance,sid);$$;
revoke all on function lms.logo_transfer_state(uuid,uuid,uuid),lms.logo_transfer_review(uuid,uuid,uuid,jsonb),lms.logo_transfer_operation(uuid,uuid,uuid,jsonb,bytea),lms.logo_transfer_history(uuid,uuid,uuid) from public,lms_auth_service;
grant execute on function lms.logo_transfer_state(uuid,uuid,uuid),lms.logo_transfer_review(uuid,uuid,uuid,jsonb),lms.logo_transfer_operation(uuid,uuid,uuid,jsonb,bytea),lms.logo_transfer_history(uuid,uuid,uuid) to lms_app;
