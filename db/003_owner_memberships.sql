-- Owner access commands. Business membership DML remains unavailable to application roles.
create table lms.access_versions (
 organization_id uuid primary key references lms.organizations(id) on delete cascade,
 revision integer not null default 0 check(revision>=0)
);
insert into lms.access_versions(organization_id) select id from lms.organizations;
create table lms.access_receipts (
 review_id uuid primary key, organization_id uuid not null references lms.organizations(id) on delete cascade,
 actor_id uuid not null references lms.users(id), session_id uuid not null,
 result jsonb not null, occurred_at timestamptz not null default now()
);
create table lms_private.membership_reviews (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references lms.organizations(id) on delete cascade,
 actor_id uuid not null references lms.users(id), session_id uuid not null references lms_identity.session(id) on delete cascade,
 target_id uuid not null, action text not null check(action in ('set-role','remove','transfer')),
 previous_role text, next_role text, expected_revision integer not null,
 reason text not null check(length(btrim(reason)) between 3 and 300),
 expires_at timestamptz not null default (clock_timestamp()+interval '5 minutes')
);
create index membership_reviews_scope on lms_private.membership_reviews(organization_id,expires_at);
create index membership_reviews_session on lms_private.membership_reviews(session_id);
create table lms_private.workspace_bootstraps (
 operation_id uuid primary key, owner_id uuid not null, organization_id uuid not null references lms.organizations(id),
 configuration jsonb not null, created_at timestamptz not null default now()
);
alter table lms.access_versions enable row level security;
alter table lms.access_versions force row level security;
alter table lms.access_receipts enable row level security;
alter table lms.access_receipts force row level security;
alter table lms_private.membership_reviews enable row level security;
alter table lms_private.membership_reviews force row level security;
alter table lms_private.workspace_bootstraps enable row level security;
alter table lms_private.workspace_bootstraps force row level security;
create policy owner_access_version on lms.access_versions for select to lms_app using(lms.has_role(organization_id,array['owner']));
create policy access_receipt_read on lms.access_receipts for select to lms_app using(
 lms.has_role(organization_id,array['owner']) or (actor_id=lms.current_user_id() and lms.has_role(organization_id,array['owner','admin','staff','viewer']))
);
grant select on lms.access_versions to lms_app;
-- Historical session IDs are private command locators, never business-query output.
grant select(review_id,organization_id,actor_id,result,occurred_at) on lms.access_receipts to lms_app;
revoke all on lms_private.membership_reviews,lms_private.workspace_bootstraps from public,lms_app,lms_auth_service;

-- Helpers are invoked only from the narrow private definer functions below.
create function lms_private.require_access_session(sid uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid:=lms.current_user_id();
begin
 if actor is null or sid is null then raise exception 'Active owner session required' using errcode='28000'; end if;
 perform 1 from lms_identity.session where id=sid and "userId"=actor and "expiresAt">clock_timestamp() for share;
 if not found then raise exception 'Active owner session required' using errcode='28000'; end if;
 return actor;
end; $$;
create function lms_private.require_access_owner(org uuid,sid uuid,exclusive_lock boolean) returns uuid language plpgsql security invoker set search_path='' as $$
declare actor uuid;
begin
 actor:=lms_private.require_access_session(sid);
 if exclusive_lock then perform 1 from lms.organizations where id=org for update;
 else perform 1 from lms.organizations where id=org for share; end if;
 if not found then raise exception 'Owner access required' using errcode='42501'; end if;
 perform lms_private.require_access_session(sid);
 if not exists(select 1 from lms.memberships where organization_id=org and user_id=actor and role='owner') then
  raise exception 'Owner access required' using errcode='42501'; end if;
 return actor;
end; $$;
create function lms_private.eligible_access_target(target uuid) returns text language plpgsql security invoker set search_path='' as $$
declare label text;
begin
 select u.name into label from lms_identity."user" u where u.id=target and u.email like '%@example.test'
 and exists(select 1 from lms_identity.account a where a."userId"=u.id and a."providerId"='credential') for share;
 if not found then raise exception 'Provision a fictional local identity first' using errcode='22023'; end if;
 return label;
end; $$;
create function lms_private.owner_access_snapshot(org uuid,sid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
 actor:=lms_private.require_access_owner(org,sid,false);
 select jsonb_build_object('organizationId',org,'revision',coalesce((select revision from lms.access_versions where organization_id=org),0),
 'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'name',u.display_name,'role',m.role) order by u.display_name,m.user_id)
 from lms.memberships m join lms.users u on u.id=m.user_id where m.organization_id=org),'[]'::jsonb)) into result;
 return result;
end; $$;
create function lms_private.prepare_membership(org uuid,sid uuid,requested_action text,target uuid,requested_role text,expected_revision integer,change_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; old_role text; new_role text; label text; current_revision integer; review lms_private.membership_reviews;
begin
 actor:=lms_private.require_access_owner(org,sid,true);
 if target is null or target=actor or requested_action is null or requested_action not in ('set-role','remove','transfer')
 or expected_revision is null or expected_revision<0 or change_reason is null or length(btrim(change_reason)) not between 3 and 300 then
  raise exception 'Invalid access change' using errcode='22023'; end if;
 if (requested_action='set-role' and (requested_role is null or requested_role not in ('admin','staff','viewer')))
 or (requested_action<>'set-role' and requested_role is not null) then raise exception 'Invalid access role' using errcode='22023'; end if;
 insert into lms.access_versions(organization_id) values(org) on conflict do nothing;
 select revision into current_revision from lms.access_versions where organization_id=org;
 if current_revision<>expected_revision then raise exception 'Access changed; review again' using errcode='40001'; end if;
 select role into old_role from lms.memberships where organization_id=org and user_id=target;
 if old_role='owner' then raise exception 'Owner membership requires a dedicated handover' using errcode='22023'; end if;
 if requested_action='set-role' then
  new_role:=requested_role; label:=lms_private.eligible_access_target(target);
  if old_role=new_role then raise exception 'No access change is needed' using errcode='22023'; end if;
 elsif requested_action='remove' then
  if old_role is null then raise exception 'Member is unavailable' using errcode='22023'; end if;
  select display_name into label from lms.users where id=target; new_role:=null;
 else
  if old_role is null or (select count(*) from lms.memberships where organization_id=org and role='owner')<>1 then
   raise exception 'Handover requires one owner and an existing member' using errcode='22023'; end if;
  new_role:='owner'; label:=lms_private.eligible_access_target(target);
 end if;
 delete from lms_private.membership_reviews where organization_id=org and expires_at<=clock_timestamp();
 if (select count(*) from lms_private.membership_reviews where organization_id=org)>=50 then raise exception 'Too many pending reviews' using errcode='54000'; end if;
 insert into lms_private.membership_reviews(organization_id,actor_id,session_id,target_id,action,previous_role,next_role,expected_revision,reason)
 values(org,actor,sid,target,requested_action,old_role,new_role,current_revision,btrim(change_reason)) returning * into review;
 return jsonb_build_object('reviewId',review.id,'organizationId',org,'actorId',actor,'targetUserId',target,'targetName',label,
 'action',requested_action,'previousRole',old_role,'role',new_role,'revision',current_revision,'reason',review.reason,'expiresAt',review.expires_at,
 'actorRoleAfter',case when requested_action='transfer' then 'admin' else 'owner' end);
end; $$;
create function lms_private.confirm_membership(rid uuid,sid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; org uuid; review lms_private.membership_reviews; receipt lms.access_receipts; current_revision integer; old_role text; label text; result jsonb;
begin
 actor:=lms_private.require_access_session(sid);
 select organization_id into org from lms_private.membership_reviews where id=rid and actor_id=actor and session_id=sid;
 if org is null then select organization_id into org from lms.access_receipts where review_id=rid and actor_id=actor and session_id=sid; end if;
 if org is null then raise exception 'Access review unavailable' using errcode='42501'; end if;
 perform 1 from lms.organizations where id=org for update;
 perform lms_private.require_access_session(sid);
 select * into receipt from lms.access_receipts where review_id=rid and actor_id=actor and session_id=sid;
 if found then
  if not exists(select 1 from lms.memberships where organization_id=org and user_id=actor) then raise exception 'Member access required' using errcode='42501'; end if;
  return receipt.result;
 end if;
 if not exists(select 1 from lms.memberships where organization_id=org and user_id=actor and role='owner') then raise exception 'Owner access required' using errcode='42501'; end if;
 select * into review from lms_private.membership_reviews where id=rid and actor_id=actor and session_id=sid for update;
 if not found then raise exception 'Access review unavailable' using errcode='42501'; end if;
 if review.expires_at<=clock_timestamp() then raise exception 'Access review expired' using errcode='40001'; end if;
 select revision into current_revision from lms.access_versions where organization_id=org;
 if current_revision<>review.expected_revision then raise exception 'Access changed; review again' using errcode='40001'; end if;
 select role into old_role from lms.memberships where organization_id=org and user_id=review.target_id;
 if old_role is distinct from review.previous_role or old_role='owner' then raise exception 'Member changed; review again' using errcode='40001'; end if;
 if review.action='remove' then
  delete from lms.memberships where organization_id=org and user_id=review.target_id;
 else
  label:=lms_private.eligible_access_target(review.target_id);
  insert into lms.users(id,display_name) values(review.target_id,label) on conflict do nothing;
  if review.action='transfer' then
   if old_role is null or (select count(*) from lms.memberships where organization_id=org and role='owner')<>1 then raise exception 'Owner changed; review again' using errcode='40001'; end if;
   update lms.memberships set role='owner' where organization_id=org and user_id=review.target_id;
   update lms.memberships set role='admin' where organization_id=org and user_id=actor;
  else
   insert into lms.memberships(organization_id,user_id,role) values(org,review.target_id,review.next_role)
   on conflict(organization_id,user_id) do update set role=excluded.role;
  end if;
 end if;
 update lms.access_versions set revision=revision+1 where organization_id=org returning revision into current_revision;
 result:=jsonb_build_object('reviewId',rid,'organizationId',org,'action',review.action,'targetUserId',review.target_id,
 'previousRole',review.previous_role,'role',review.next_role,'revision',current_revision,'reason',review.reason,
 'actorRoleAfter',case when review.action='transfer' then 'admin' else 'owner' end);
 insert into lms.access_receipts(review_id,organization_id,actor_id,session_id,result) values(rid,org,actor,sid,result);
 insert into lms.audit_events(organization_id,actor_id,entity,record_id,action,before_data,after_data)
 values(org,actor,'membership',review.target_id,review.action,jsonb_build_object('role',review.previous_role,'actorRole','owner'),result);
 delete from lms_private.membership_reviews where id=rid;
 return result;
end; $$;
-- Public wrappers are invokers; elevated code is private, narrow and independently authorizes.
create function lms.owner_access_snapshot(org uuid,sid uuid) returns jsonb language sql security invoker set search_path='' as $$ select lms_private.owner_access_snapshot(org,sid); $$;
create function lms.prepare_membership(org uuid,sid uuid,requested_action text,target uuid,requested_role text,expected_revision integer,change_reason text) returns jsonb language sql security invoker set search_path='' as $$ select lms_private.prepare_membership(org,sid,requested_action,target,requested_role,expected_revision,change_reason); $$;
create function lms.confirm_membership(rid uuid,sid uuid) returns jsonb language sql security invoker set search_path='' as $$ select lms_private.confirm_membership(rid,sid); $$;
revoke all on function lms_private.require_access_session(uuid),lms_private.require_access_owner(uuid,uuid,boolean),lms_private.eligible_access_target(uuid) from public,lms_app;
revoke all on function lms_private.owner_access_snapshot(uuid,uuid),lms_private.prepare_membership(uuid,uuid,text,uuid,text,integer,text),lms_private.confirm_membership(uuid,uuid) from public;
revoke all on function lms.owner_access_snapshot(uuid,uuid),lms.prepare_membership(uuid,uuid,text,uuid,text,integer,text),lms.confirm_membership(uuid,uuid) from public;
grant usage on schema lms_private to lms_app;
grant execute on function lms_private.owner_access_snapshot(uuid,uuid),lms_private.prepare_membership(uuid,uuid,text,uuid,text,integer,text),lms_private.confirm_membership(uuid,uuid) to lms_app;
grant execute on function lms.owner_access_snapshot(uuid,uuid),lms.prepare_membership(uuid,uuid,text,uuid,text,integer,text),lms.confirm_membership(uuid,uuid) to lms_app;
