-- Independent LMS schema. Portable PostgreSQL; no auth provider or production data.
begin;
create role lms_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
create schema lms;
create schema lms_private;
revoke all on schema lms_private from public;
revoke all on schema lms from public;
grant usage on schema lms to lms_app;
create table lms.users (id uuid primary key, display_name text not null);
create table lms.organizations (id uuid primary key, name text not null);
create table lms.memberships (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 user_id uuid not null references lms.users(id) on delete cascade,
 role text not null check(role in ('owner','admin','staff','viewer')),
 primary key(organization_id,user_id)
);
create index memberships_user_scope on lms.memberships(user_id,organization_id);
create function lms.current_user_id() returns uuid language sql stable security invoker set search_path='' as $$
 select nullif(current_setting('lms.user_id',true),'')::uuid;
$$;
create function lms.has_role(org uuid, roles text[]) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from lms.memberships where organization_id=org and user_id=(select lms.current_user_id()) and role=any(roles));
$$;
create table lms.config_revisions (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 revision integer not null check(revision>0), document jsonb not null check(jsonb_typeof(document)='object' and document->>'schemaVersion'='1'),
 restored_from integer, created_by uuid not null references lms.users(id), created_at timestamptz not null default now(),
 primary key(organization_id,revision), foreign key(organization_id,restored_from) references lms.config_revisions(organization_id,revision)
);
create table lms.records (
 organization_id uuid not null references lms.organizations(id) on delete cascade,
 id uuid not null default gen_random_uuid(), entity text not null check(entity ~ '^[a-z][a-z0-9_-]{0,39}$'),
 data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=32768),
 revision integer not null default 1, config_revision integer not null,
 archived boolean not null default false,
 created_by uuid not null references lms.users(id), updated_by uuid not null references lms.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(organization_id,id), foreign key(organization_id,config_revision) references lms.config_revisions(organization_id,revision)
);
create index records_scope on lms.records(organization_id,entity,archived,id);
create table lms.audit_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references lms.organizations(id) on delete cascade,
 actor_id uuid not null references lms.users(id), entity text not null, record_id uuid,
 action text not null, before_data jsonb, after_data jsonb, occurred_at timestamptz not null default now()
);
create index audit_scope on lms.audit_events(organization_id,occurred_at desc,id);

alter table lms.users enable row level security;
alter table lms.users force row level security;
alter table lms.organizations enable row level security;
alter table lms.organizations force row level security;
alter table lms.memberships enable row level security;
alter table lms.memberships force row level security;
alter table lms.config_revisions enable row level security;
alter table lms.config_revisions force row level security;
alter table lms.records enable row level security;
alter table lms.records force row level security;
alter table lms.audit_events enable row level security;
alter table lms.audit_events force row level security;
create policy own_user on lms.users for select to lms_app using(id=(select lms.current_user_id()));
create policy own_memberships on lms.memberships for select to lms_app using(user_id=(select lms.current_user_id()));
create policy member_org on lms.organizations for select to lms_app using(lms.has_role(id,array['owner','admin','staff','viewer']));
-- FOR UPDATE locks serialize service commands; WITH CHECK false forbids changing organization IDs.
grant update(id) on lms.organizations to lms_app;
create policy lock_org on lms.organizations for update to lms_app using(lms.has_role(id,array['owner','admin','staff'])) with check(false);
create policy read_config on lms.config_revisions for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy add_config on lms.config_revisions for insert to lms_app with check(lms.has_role(organization_id,array['owner','admin']) and created_by=(select lms.current_user_id()));
create policy read_records on lms.records for select to lms_app using(lms.has_role(organization_id,array['owner','admin','staff','viewer']));
create policy add_record on lms.records for insert to lms_app with check(lms.has_role(organization_id,array['owner','admin','staff']) and created_by=(select lms.current_user_id()) and updated_by=(select lms.current_user_id()));
create policy edit_record on lms.records for update to lms_app using(lms.has_role(organization_id,array['owner','admin','staff'])) with check(lms.has_role(organization_id,array['owner','admin','staff']) and updated_by=(select lms.current_user_id()));
create policy read_audit on lms.audit_events for select to lms_app using(lms.has_role(organization_id,array['owner','admin']));
grant select on all tables in schema lms to lms_app;
grant insert on lms.config_revisions,lms.records to lms_app;
grant update on lms.records to lms_app;
revoke all on all functions in schema lms from public;
grant execute on all functions in schema lms to lms_app;

create function lms_private.guard_record() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if (new.organization_id,new.id,new.entity,new.created_by,new.created_at) is distinct from (old.organization_id,old.id,old.entity,old.created_by,old.created_at) then raise exception 'Record identity is immutable' using errcode='23514'; end if;
  new.revision:=old.revision+1;
 else
  new.revision:=1;
 end if;
 new.updated_by:=lms.current_user_id();
 new.updated_at:=now();
 return new;
end; $$;
create trigger record_guard before insert or update on lms.records for each row execute function lms_private.guard_record();
-- A narrow trigger is the only elevated write: app has no INSERT/UPDATE/DELETE on audits.
create function lms_private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare doc jsonb:=to_jsonb(new);
begin
 if lms.current_user_id() is null then raise exception 'Actor is required'; end if;
 insert into lms.audit_events(organization_id,actor_id,entity,record_id,action,before_data,after_data)
 values(new.organization_id,lms.current_user_id(),coalesce(doc->>'entity','configuration'),(doc->>'id')::uuid,
 lower(tg_op),case when tg_op='UPDATE' then to_jsonb(old) else null end,doc);
 return new;
end; $$;
revoke all on all functions in schema lms_private from public;
create trigger record_audit after insert or update on lms.records for each row execute function lms_private.audit_change();
create trigger config_audit after insert on lms.config_revisions for each row execute function lms_private.audit_change();
commit;
