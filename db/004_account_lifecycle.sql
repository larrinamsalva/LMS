-- Credential events contain no passwords, hashes, tokens, session IDs or business data.
create table lms_identity.credential_events (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid unique,
 subject_id uuid not null,
 action text not null check(action='password-changed'),
 occurred_at timestamptz not null default clock_timestamp()
);
create index credential_events_subject on lms_identity.credential_events(subject_id,occurred_at);
alter table lms_identity.credential_events enable row level security;
alter table lms_identity.credential_events force row level security;
revoke all on lms_identity.credential_events from public,lms_app,lms_auth_service;
create policy credential_event_read on lms_identity.credential_events for select to lms_auth_service using(true);
grant select on lms_identity.credential_events to lms_auth_service;

-- Audit the actual database mutation in its transaction, including trusted maintenance.
-- A reused host operation UUID aborts the entire credential/session transaction.
create function lms_private.audit_credential_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.password is distinct from old.password then
  insert into lms_identity.credential_events(operation_id,subject_id,action)
  values(nullif(current_setting('lms.credential_operation',true),'')::uuid,new."userId",'password-changed');
 end if;
 return new;
end; $$;
revoke all on function lms_private.audit_credential_change() from public,lms_app,lms_auth_service;
create trigger credential_change_audit after update of password on lms_identity.account
 for each row execute function lms_private.audit_credential_change();

-- One shared recent-session rule for credential and owner commands. The caller is
-- either the trusted identity service or an independently authorizing owner definer.
-- Check time AFTER waiting for the row lock; a session can expire while blocked.
create function lms_identity.require_recent_session(actor uuid,sid uuid,exclusive_lock boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 if actor is null or sid is null then raise exception 'Recent sign-in required' using errcode='28000'; end if;
 if exclusive_lock then
  perform 1 from lms_identity.session where id=sid and "userId"=actor for update;
 else
  perform 1 from lms_identity.session where id=sid and "userId"=actor for share;
 end if;
 if not found then raise exception 'Recent sign-in required' using errcode='28000'; end if;
 if not exists(select 1 from lms_identity.session where id=sid and "userId"=actor
  and "expiresAt">clock_timestamp() and "createdAt">clock_timestamp()-interval '5 minutes'
  and "createdAt"<=clock_timestamp()) then
  raise exception 'Recent sign-in required' using errcode='28000';
 end if;
 return actor;
end; $$;
revoke all on function lms_identity.require_recent_session(uuid,uuid,boolean) from public,lms_app;
grant execute on function lms_identity.require_recent_session(uuid,uuid,boolean) to lms_auth_service;

-- Preserve the existing owner permission, review, lock and last-owner contracts.
-- All owner command entry points already call this helper before/after org locks.
create or replace function lms_private.require_access_session(sid uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 return lms_identity.require_recent_session(lms.current_user_id(),sid,false);
end; $$;
revoke all on function lms_private.require_access_session(uuid) from public,lms_app,lms_auth_service;
