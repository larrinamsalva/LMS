-- Recovery is local maintenance. No new role receives credential or business administration.
create schema if not exists lms_control;
revoke all on schema lms_control from public;
grant usage on schema lms_control to lms_app,lms_auth_service;
create table lms_control.state (
 singleton boolean primary key default true check(singleton),
 instance_id uuid not null default gen_random_uuid(),
 blocked boolean not null default false,
 reason text check(reason in ('recovery-pending','recovered-offline','restored-archive'))
);
insert into lms_control.state(singleton) values(true);
do $$ begin
 if to_regclass('lms_control.restore_blocker') is not null or exists(select 1 from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=0 and 'lms.restore_blocked=on'=any(s.setconfig)) then
  update lms_control.state set blocked=true,reason='restored-archive';
 end if;
end; $$;
alter table lms_control.state enable row level security;
alter table lms_control.state force row level security;
create policy runtime_status on lms_control.state for select to lms_app,lms_auth_service using(true);
revoke all on lms_control.state from public,lms_app,lms_auth_service;
grant select on lms_control.state to lms_app,lms_auth_service;
create function lms_control.is_blocked() returns boolean language sql security invoker set search_path='' as $$
 select to_regclass('lms_control.restore_blocker') is not null or exists(select 1 from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=0 and 'lms.restore_blocked=on'=any(s.setconfig)) or not exists(select 1 from lms_control.state where singleton and not blocked);
$$;
revoke all on function lms_control.is_blocked() from public;
grant execute on function lms_control.is_blocked() to lms_app,lms_auth_service;
create function lms_control.require_online() returns void language plpgsql security invoker set search_path='' as $$
begin
 if not pg_try_advisory_xact_lock_shared(74021906) then raise exception 'Offline maintenance in progress' using errcode='55000'; end if;
 if lms_control.is_blocked() then raise exception 'Recovery activation blocked' using errcode='55000'; end if;
end; $$;
revoke all on function lms_control.require_online() from public;
grant execute on function lms_control.require_online() to lms_app,lms_auth_service;
create function lms_control.runtime_write_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not (select rolsuper from pg_roles where rolname=current_user) then perform lms_control.require_online(); end if;
 return new;
end; $$;
revoke all on function lms_control.runtime_write_guard() from public;
create trigger runtime_record_guard before insert or update on lms.records for each row execute function lms_control.runtime_write_guard();
create trigger runtime_config_guard before insert on lms.config_revisions for each row execute function lms_control.runtime_write_guard();
create trigger runtime_session_guard before insert or update on lms_identity.session for each row execute function lms_control.runtime_write_guard();
create trigger runtime_account_guard before insert or update on lms_identity.account for each row execute function lms_control.runtime_write_guard();
create trigger runtime_user_guard before insert or update on lms_identity."user" for each row execute function lms_control.runtime_write_guard();
create or replace function lms_private.require_access_session(sid uuid) returns uuid language plpgsql security invoker set search_path='' as $$
begin
 perform lms_control.require_online();
 return lms_identity.require_recent_session(lms.current_user_id(),sid,false);
end; $$;
revoke all on function lms_private.require_access_session(uuid) from public,lms_app,lms_auth_service;

create table lms_identity.credential_versions (
 account_id uuid primary key references lms_identity.account(id) on delete cascade,
 version uuid not null default gen_random_uuid()
);
insert into lms_identity.credential_versions(account_id) select id from lms_identity.account where "providerId"='credential';
alter table lms_identity.credential_versions enable row level security;
alter table lms_identity.credential_versions force row level security;
revoke all on lms_identity.credential_versions from public,lms_app,lms_auth_service;
create function lms_private.version_credential() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new."providerId"='credential' and (tg_op='INSERT' or new.password is distinct from old.password) then
  insert into lms_identity.credential_versions(account_id) values(new.id)
  on conflict(account_id) do update set version=gen_random_uuid();
 end if;
 return new;
end; $$;
revoke all on function lms_private.version_credential() from public,lms_app,lms_auth_service;
create trigger credential_version after insert or update of password on lms_identity.account for each row execute function lms_private.version_credential();

create table lms_private.recovery_trust (
 digest text primary key check(digest ~ '^[a-f0-9]{64}$'), registry_id uuid not null,
 trusted_at timestamptz not null default clock_timestamp()
);
create table lms_private.recovery_cases (
 id uuid primary key, subject_id uuid not null, account_id uuid not null,
 registry_digest text not null references lms_private.recovery_trust(digest),
 context jsonb not null, expires_at timestamptz not null,
 status text not null default 'opened' check(status in ('opened','verified','approved','completed')),
 verification jsonb, approval jsonb, approved_at timestamptz, completed_at timestamptz
);
create table lms_private.recovery_events (
 id uuid primary key default gen_random_uuid(), case_id uuid, subject_id uuid, operator_id uuid,
 action text not null check(action in ('trust-enrolled','opened','verified','approved','completed','rejected')),
 code text, occurred_at timestamptz not null default clock_timestamp()
);
create index recovery_events_case on lms_private.recovery_events(case_id,occurred_at);
alter table lms_private.recovery_trust enable row level security;
alter table lms_private.recovery_trust force row level security;
alter table lms_private.recovery_cases enable row level security;
alter table lms_private.recovery_cases force row level security;
alter table lms_private.recovery_events enable row level security;
alter table lms_private.recovery_events force row level security;
revoke all on lms_private.recovery_trust,lms_private.recovery_cases,lms_private.recovery_events from public,lms_app,lms_auth_service;
