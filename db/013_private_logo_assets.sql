-- Additive host-only fictional asset contract. SQL 1-12 and published branding formats are unchanged.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before private asset migration' using errcode='55000'; end if;
end; $$;

-- Defense in depth for the pinned sanitizer output, not a second image decoder.
create function lms_private.valid_logo_png(p bytea) returns boolean language plpgsql immutable set search_path='' as $$
declare pos integer:=8; size bigint; kind text; seen_data boolean:=false; seen_phys boolean:=false; w bigint; h bigint;
begin
 if p is null or octet_length(p) not between 57 and 262144 or substring(p from 1 for 8)<>decode('89504e470d0a1a0a','hex') then return false; end if;
 w:=get_byte(p,16)::bigint*16777216+get_byte(p,17)*65536+get_byte(p,18)*256+get_byte(p,19);
 h:=get_byte(p,20)::bigint*16777216+get_byte(p,21)*65536+get_byte(p,22)*256+get_byte(p,23);
 if w not between 1 and 512 or h not between 1 and 512 or get_byte(p,24)<>8 or get_byte(p,25) not in (2,6) or get_byte(p,26)<>0 or get_byte(p,27)<>0 or get_byte(p,28)<>0 then return false;end if;
 while pos+12<=octet_length(p) loop
  size:=get_byte(p,pos)::bigint*16777216+get_byte(p,pos+1)*65536+get_byte(p,pos+2)*256+get_byte(p,pos+3);
  if size>262144 or pos+size+12>octet_length(p) then return false;end if;
  kind:=encode(substring(p from pos+5 for 4),'hex');
  if pos=8 then
   if kind<>'49484452' or size<>13 then return false;end if;
  elsif kind='70485973' then
   if size<>9 or seen_phys or seen_data then return false;end if;seen_phys:=true;
  elsif kind='49444154' then
   if size=0 then return false;end if;seen_data:=true;
  elsif kind='49454e44' then
   return seen_data and size=0 and pos+12=octet_length(p) and substring(p from pos+9 for 4)=decode('ae426082','hex');
  else return false;
  end if;
  pos:=pos+size::integer+12;
 end loop;
 return false;
exception when others then return false;
end; $$;
revoke all on function lms_private.valid_logo_png(bytea) from public,lms_app,lms_auth_service;

create table lms.logo_assets (
 organization_id uuid not null references lms.organizations(id), id uuid not null default gen_random_uuid(),
 revision integer not null default 1 check(revision>0),
 state text not null default 'stored' check(state in ('stored','selected','superseded','unreferenced','retired','blocked')),
 format text not null default 'png' check(format='png'), sanitizer text not null default 'sharp-0.35.5/png-v1' check(sanitizer='sharp-0.35.5/png-v1'),
 width integer not null check(width between 1 and 512),height integer not null check(height between 1 and 512),
 bytes integer not null check(bytes between 1 and 262144), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 display text not null check(display in ('square','rectangle')), content bytea not null,
 created_by uuid not null references lms.users(id),created_at timestamptz not null default clock_timestamp(),unreferenced_at timestamptz,
 primary key(organization_id,id),
 constraint logo_content_integrity check(bytes=octet_length(content) and sha256=encode(sha256(content),'hex'))
);
create unique index logo_one_selected on lms.logo_assets(organization_id) where state='selected';
create table lms.logo_asset_states (
 organization_id uuid primary key references lms.organizations(id), revision integer not null default 0 check(revision>=0), asset_id uuid,
 foreign key(organization_id,asset_id) references lms.logo_assets(organization_id,id)
);
create table lms.logo_asset_receipts (
 organization_id uuid not null references lms.organizations(id), operation_id uuid not null, actor_id uuid not null references lms.users(id),
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'), result jsonb not null, occurred_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,operation_id)
);
create table lms.logo_asset_history (
 organization_id uuid not null, asset_id uuid not null,revision integer not null check(revision>0),
 state text not null check(state in ('stored','selected','superseded','unreferenced','retired','blocked')),
 actor_id uuid not null references lms.users(id), operation_id uuid not null, occurred_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,asset_id,revision),
 foreign key(organization_id,asset_id) references lms.logo_assets(organization_id,id),
 foreign key(organization_id,operation_id) references lms.logo_asset_receipts(organization_id,operation_id) deferrable initially deferred
);
alter table lms.logo_assets enable row level security;
alter table lms.logo_assets force row level security;
alter table lms.logo_asset_states enable row level security;
alter table lms.logo_asset_states force row level security;
alter table lms.logo_asset_receipts enable row level security;
alter table lms.logo_asset_receipts force row level security;
alter table lms.logo_asset_history enable row level security;
alter table lms.logo_asset_history force row level security;
create policy logo_states_read on lms.logo_asset_states for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy logo_metadata_read on lms.logo_assets for select to lms_app using(lms.has_role(organization_id,array['owner','admin']) or (lms.has_role(organization_id,array['staff','viewer']) and exists(select 1 from lms.logo_asset_states s where s.organization_id=logo_assets.organization_id and s.asset_id=logo_assets.id)));
create policy logo_receipts_read on lms.logo_asset_receipts for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
create policy logo_history_read on lms.logo_asset_history for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
revoke all on lms.logo_assets,lms.logo_asset_states,lms.logo_asset_receipts,lms.logo_asset_history from public,lms_app,lms_auth_service;
-- Bytes cannot be read with a table SELECT, even by an owner using lms_app.
grant select(organization_id,id,revision,state,format,sanitizer,width,height,bytes,sha256,display,created_at,unreferenced_at) on lms.logo_assets to lms_app;
grant select on lms.logo_asset_states,lms.logo_asset_receipts,lms.logo_asset_history to lms_app;

create function lms_private.logo_authorize(org uuid,instance uuid,manage boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform lms_control.require_online();
 if exists(select 1 from lms_identity."user" where email not like '%@example.test') then raise exception 'Private assets require the trusted fictional lab' using errcode='42501';end if;
 if instance is null or not exists(select 1 from lms_control.state where singleton and instance_id=instance and not blocked) then raise exception 'Private asset instance changed' using errcode='55000';end if;
 if manage then perform 1 from lms.organizations where id=org for update;
 else perform 1 from lms.organizations where id=org for share;end if;
 if not found then raise exception 'Private asset access unavailable' using errcode='42501';end if;
 perform 1 from lms.memberships where organization_id=org and user_id=lms.current_user_id() and role=any(case when manage then array['owner','admin'] else array['owner','admin','staff','viewer'] end) for share;
 if not found then raise exception 'Private asset access unavailable' using errcode='42501';end if;
end; $$;
create function lms_private.logo_metadata(a lms.logo_assets) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version',1,'id',a.id,'organizationId',a.organization_id,'revision',a.revision,'state',a.state,'format',a.format,'sanitizer',a.sanitizer,'width',a.width,'height',a.height,'bytes',a.bytes,'sha256',a.sha256,'display',a.display,
 'createdAt',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'unreferencedAt',case when a.unreferenced_at is not null then to_char(a.unreferenced_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
 'retentionEligibleAt',case when a.unreferenced_at is not null then to_char((a.unreferenced_at+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
$$;
create function lms_private.logo_snapshot(org uuid,instance uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s lms.logo_asset_states; manager boolean;
begin
 perform lms_private.logo_authorize(org,instance,false);
 manager:=lms.has_role(org,array['owner','admin']);
 select * into s from lms.logo_asset_states where organization_id=org;
 return jsonb_build_object('version',1,'revision',coalesce(s.revision,0),'selectedId',s.asset_id,'canManage',manager,
 'assets',(select coalesce(jsonb_agg(lms_private.logo_metadata(a) order by a.created_at,a.id),'[]'::jsonb) from lms.logo_assets a where organization_id=org and (manager or a.id=s.asset_id)));
end; $$;
create function lms_private.logo_history(org uuid,instance uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform lms_private.logo_authorize(org,instance,true);
 return (select coalesce(jsonb_agg(jsonb_build_object('assetId',asset_id,'revision',revision,'state',state,'actorId',actor_id,'operationId',operation_id,'occurredAt',to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by occurred_at,asset_id,revision),'[]'::jsonb) from lms.logo_asset_history where organization_id=org);
end; $$;
create function lms_private.logo_read(org uuid,instance uuid,asset uuid,expected integer) returns table(image bytea,metadata jsonb) language plpgsql security definer set search_path='' as $$
declare a lms.logo_assets;
begin
 perform lms_private.logo_authorize(org,instance,false);
 select * into a from lms.logo_assets where organization_id=org and id=asset;
 if not found or (not lms.has_role(org,array['owner','admin']) and not exists(select 1 from lms.logo_asset_states where organization_id=org and asset_id=asset)) or a.state in ('retired','blocked') then raise exception 'Private asset unavailable' using errcode='42501';end if;
 if expected is null or a.revision<>expected then raise exception 'Private asset revision changed' using errcode='40001';end if;
 if not lms_private.valid_logo_png(a.content) or octet_length(a.content)<>a.bytes or encode(sha256(a.content),'hex')<>a.sha256 then raise exception 'Private asset integrity failed; quarantine for inspection' using errcode='23514';end if;
 return query select a.content,lms_private.logo_metadata(a);
end; $$;
create function lms_private.logo_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Private asset history and receipts are immutable' using errcode='23514';end; $$;
create trigger logo_history_immutable before update or delete on lms.logo_asset_history for each row execute function lms_private.logo_immutable();
create trigger logo_receipts_immutable before update or delete on lms.logo_asset_receipts for each row execute function lms_private.logo_immutable();
create function lms_private.logo_asset_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Private logo bytes are retained; physical deletion is unsupported' using errcode='23514';end if;
 if tg_op='UPDATE' then
  if (new.organization_id,new.id,new.content,new.format,new.sanitizer,new.width,new.height,new.bytes,new.sha256,new.display,new.created_by,new.created_at) is distinct from (old.organization_id,old.id,old.content,old.format,old.sanitizer,old.width,old.height,old.bytes,old.sha256,old.display,old.created_by,old.created_at) or new.revision<>old.revision+1 then raise exception 'Stored image bytes and identity are immutable' using errcode='23514';end if;
  if not ((old.state='stored' and new.state in ('selected','unreferenced','blocked')) or (old.state='selected' and new.state in ('superseded','unreferenced')) or (old.state='superseded' and new.state in ('unreferenced','blocked')) or (old.state='unreferenced' and new.state in ('stored','retired','blocked'))) then raise exception 'Unsupported private asset transition' using errcode='23514';end if;
 else
  if new.state<>'stored' or new.revision<>1 then raise exception 'New private assets start stored' using errcode='23514';end if;
 end if;
 if (tg_op='INSERT' or new.state in ('stored','selected')) and not lms_private.valid_logo_png(new.content) then raise exception 'Use the reviewed sanitized PNG output' using errcode='23514';end if;
 return new;
end; $$;
create trigger logo_asset_guard before insert or update or delete on lms.logo_assets for each row execute function lms_private.logo_asset_guard();
create function lms_private.logo_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into lms.logo_asset_history(organization_id,asset_id,revision,state,actor_id,operation_id) values(new.organization_id,new.id,new.revision,new.state,lms.current_user_id(),nullif(current_setting('lms.logo_operation',true),'')::uuid);
 return new;
end; $$;
create trigger logo_event after insert or update on lms.logo_assets for each row execute function lms_private.logo_event();

create function lms_private.logo_operation(org uuid,instance uuid,command jsonb,png bytea) returns jsonb language plpgsql security definer set search_path='' as $$
declare s lms.logo_asset_states; a lms.logo_assets; prior lms.logo_asset_receipts; op uuid; actor uuid:=lms.current_user_id(); action text; request_digest text; result jsonb; n integer; total bigint; w integer; h integer;
begin
 perform lms_private.logo_authorize(org,instance,true);
 if jsonb_typeof(command) is distinct from 'object' or command->'version' is distinct from '1'::jsonb or command->>'operationId' is null or jsonb_typeof(command->'expectedRevision') is distinct from 'number' or coalesce(command->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,8})$' then raise exception 'Invalid private asset command' using errcode='23514';end if;
 op:=(command->>'operationId')::uuid;action:=command->>'action';
 if action='store' then
  if exists(select 1 from jsonb_object_keys(command)k where k not in ('version','operationId','expectedRevision','action','display','inputSha256')) or coalesce(command->>'display','') not in ('square','rectangle') or coalesce(command->>'inputSha256','') !~ '^[a-f0-9]{64}$' or not lms_private.valid_logo_png(png) then raise exception 'Use reviewed sanitized PNG intake' using errcode='23514';end if;
 elsif action in ('select','unselect','release','restore','retire','block') then
  if png is not null or exists(select 1 from jsonb_object_keys(command)k where k not in ('version','operationId','expectedRevision','action','assetId','assetRevision')) or command->>'assetId' is null or coalesce(command->>'assetRevision','') !~ '^[1-9][0-9]{0,8}$' then raise exception 'Invalid private asset transition' using errcode='23514';end if;
 else raise exception 'Unsupported private asset operation' using errcode='23514';end if;
 request_digest:=encode(sha256(convert_to(command::text||coalesce(encode(sha256(png),'hex'),''),'UTF8')),'hex');
 select * into prior from lms.logo_asset_receipts where organization_id=org and operation_id=op;
 if found then
  if prior.actor_id<>actor or prior.request_digest<>request_digest then raise exception 'Private asset retry conflicts with original operation' using errcode='40001';end if;
  return prior.result;
 end if;
 insert into lms.logo_asset_states(organization_id) values(org) on conflict do nothing;
 -- Updating the real cursor rejects stale REPEATABLE READ snapshots as well as ordinary concurrent edits.
 select * into strict s from lms.logo_asset_states where organization_id=org for update;
 if s.revision<>(command->>'expectedRevision')::integer then raise exception 'Private asset choices changed; refresh' using errcode='40001';end if;
 select count(*) into n from lms.logo_asset_receipts where organization_id=org;
 if n>=(case when action in ('unselect','release','retire','block') then 160 else 128 end) then raise exception 'Private asset operation budget exhausted; reviewed retention work required' using errcode='23514';end if;
 perform set_config('lms.logo_operation',op::text,true);
 if action='store' then
  select count(*),coalesce(sum(bytes),0) into n,total from lms.logo_assets where organization_id=org;
  if n>=16 or total+octet_length(png)>2097152 then raise exception 'Private asset storage quota exhausted; retirement does not delete bytes or reset quotas' using errcode='23514';end if;
  w:=get_byte(png,16)*16777216+get_byte(png,17)*65536+get_byte(png,18)*256+get_byte(png,19);
  h:=get_byte(png,20)*16777216+get_byte(png,21)*65536+get_byte(png,22)*256+get_byte(png,23);
  insert into lms.logo_assets(organization_id,content,width,height,bytes,sha256,display,created_by) values(org,png,w,h,octet_length(png),encode(sha256(png),'hex'),command->>'display',actor) returning * into a;
 else
  select * into a from lms.logo_assets where organization_id=org and id=(command->>'assetId')::uuid for update;
  if not found or a.revision<>(command->>'assetRevision')::integer then raise exception 'Private asset is missing or changed' using errcode='40001';end if;
  if action='select' then
   if a.state<>'stored' then raise exception 'Only a reviewed stored asset can be selected' using errcode='23514';end if;
   if s.asset_id is not null then update lms.logo_assets set state='superseded',revision=revision+1 where organization_id=org and id=s.asset_id and state='selected';if not found then raise exception 'Selection history is inconsistent' using errcode='23514';end if;end if;
   update lms.logo_assets set state='selected',revision=revision+1 where organization_id=org and id=a.id returning * into a;
   s.asset_id:=a.id;
  elsif action='unselect' then
   if a.state<>'selected' or s.asset_id is distinct from a.id then raise exception 'Only the current selection can be released' using errcode='23514';end if;
   update lms.logo_assets set state='unreferenced',revision=revision+1,unreferenced_at=clock_timestamp() where organization_id=org and id=a.id returning * into a;s.asset_id:=null;
  elsif action='release' then
   if a.state not in ('stored','superseded') or s.asset_id=a.id then raise exception 'Release requires an unselected retained asset' using errcode='23514';end if;
   update lms.logo_assets set state='unreferenced',revision=revision+1,unreferenced_at=clock_timestamp() where organization_id=org and id=a.id returning * into a;
  elsif action='restore' then
   if a.state<>'unreferenced' then raise exception 'Only retained unreferenced assets can return to stored' using errcode='23514';end if;
   update lms.logo_assets set state='stored',revision=revision+1,unreferenced_at=null where organization_id=org and id=a.id returning * into a;
  elsif action='retire' then
   if a.state<>'unreferenced' or s.asset_id=a.id then raise exception 'Retirement requires explicit unreferencing first' using errcode='23514';end if;
   update lms.logo_assets set state='retired',revision=revision+1 where organization_id=org and id=a.id returning * into a;
  else
   if a.state not in ('stored','superseded','unreferenced') or s.asset_id=a.id then raise exception 'Unselect an asset before blocking; terminal assets cannot be revived' using errcode='23514';end if;
   update lms.logo_assets set state='blocked',revision=revision+1 where organization_id=org and id=a.id returning * into a;
  end if;
 end if;
 update lms.logo_asset_states set revision=revision+1,asset_id=s.asset_id where organization_id=org returning * into s;
 result:=jsonb_build_object('version',1,'operationId',op,'revision',s.revision,'assetId',a.id,'assetRevision',a.revision,'action',action);
 insert into lms.logo_asset_receipts(organization_id,operation_id,actor_id,request_digest,result) values(org,op,actor,request_digest,result);
 return result;
end; $$;

revoke all on function lms_private.logo_authorize(uuid,uuid,boolean),lms_private.logo_metadata(lms.logo_assets),lms_private.logo_immutable(),lms_private.logo_asset_guard(),lms_private.logo_event() from public,lms_app,lms_auth_service;
revoke all on function lms_private.logo_snapshot(uuid,uuid),lms_private.logo_history(uuid,uuid),lms_private.logo_read(uuid,uuid,uuid,integer),lms_private.logo_operation(uuid,uuid,jsonb,bytea) from public,lms_auth_service;
grant execute on function lms_private.logo_snapshot(uuid,uuid),lms_private.logo_history(uuid,uuid),lms_private.logo_read(uuid,uuid,uuid,integer),lms_private.logo_operation(uuid,uuid,jsonb,bytea) to lms_app;
create function lms.logo_snapshot(org uuid,instance uuid) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_snapshot(org,instance);$$;
create function lms.logo_history(org uuid,instance uuid) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_history(org,instance);$$;
create function lms.logo_read(org uuid,instance uuid,asset uuid,expected integer) returns table(image bytea,metadata jsonb) language sql security invoker set search_path='' as $$select * from lms_private.logo_read(org,instance,asset,expected);$$;
create function lms.logo_operation(org uuid,instance uuid,command jsonb,png bytea) returns jsonb language sql security invoker set search_path='' as $$select lms_private.logo_operation(org,instance,command,png);$$;
revoke all on function lms.logo_snapshot(uuid,uuid),lms.logo_history(uuid,uuid),lms.logo_read(uuid,uuid,uuid,integer),lms.logo_operation(uuid,uuid,jsonb,bytea) from public,lms_auth_service;
grant execute on function lms.logo_snapshot(uuid,uuid),lms.logo_history(uuid,uuid),lms.logo_read(uuid,uuid,uuid,integer),lms.logo_operation(uuid,uuid,jsonb,bytea) to lms_app;
