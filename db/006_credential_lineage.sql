-- Offline enrollment only: a live v5+ host lease prevents an unsafe backfill.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before lineage enrollment' using errcode='55000'; end if;
end; $$;
lock table lms_identity.account,lms_identity.credential_versions,lms_identity.credential_events,lms_private.recovery_events in access exclusive mode nowait;
create table lms_private.lineage_stream (
 singleton boolean primary key default true check(singleton),
 stream_id uuid not null default gen_random_uuid(),
 genesis_eligible boolean not null,
 sequence bigint not null default 0 check(sequence>=0),
 head_digest text not null default repeat('0',64) check(head_digest ~ '^[a-f0-9]{64}$')
);
insert into lms_private.lineage_stream(singleton,genesis_eligible) values(true,not lms_control.is_blocked());
create table lms_private.lineage_entries (
 sequence bigint primary key check(sequence>0),
 previous_digest text not null check(previous_digest ~ '^[a-f0-9]{64}$'),
 payload text not null check(octet_length(payload)<=4096),
 digest text not null check(digest ~ '^[a-f0-9]{64}$')
);
alter table lms_private.lineage_stream enable row level security;
alter table lms_private.lineage_stream force row level security;
alter table lms_private.lineage_entries enable row level security;
alter table lms_private.lineage_entries force row level security;
revoke all on lms_private.lineage_stream,lms_private.lineage_entries from public,lms_app,lms_auth_service;

create function lms_private.append_lineage(p_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare current_stream lms_private.lineage_stream; next_sequence bigint; next_digest text;
begin
 select * into strict current_stream from lms_private.lineage_stream where singleton for update;
 next_sequence:=current_stream.sequence+1;
 next_digest:=encode(sha256(convert_to(concat_ws(E'\n','lms-credential-entry-v1',current_stream.stream_id::text,next_sequence::text,current_stream.head_digest,p_payload::text),'UTF8')),'hex');
 insert into lms_private.lineage_entries(sequence,previous_digest,payload,digest) values(next_sequence,current_stream.head_digest,p_payload::text,next_digest);
 update lms_private.lineage_stream set sequence=next_sequence,head_digest=next_digest where singleton;
end; $$;
revoke all on function lms_private.append_lineage(jsonb) from public,lms_app,lms_auth_service;

-- Explicit metadata only. Never serialize a credential/account row into the outbox.
create function lms_private.lineage_payload(kind text,event_id uuid,subject uuid,account uuid,credential_version uuid,operation uuid,recovery_case uuid,operator uuid,action text,occurred timestamptz) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('kind',kind,'eventId',event_id,'subjectId',subject,'accountId',account,'credentialVersion',credential_version,'operationId',operation,'caseId',recovery_case,'operatorId',operator,'action',action,'occurredAt',to_char(occurred at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
revoke all on function lms_private.lineage_payload(text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,timestamptz) from public,lms_app,lms_auth_service;

-- This is an explicitly adopted baseline, not proof of pre-enrollment history.
do $$ declare item record; begin
 for item in select v.account_id,v.version,a."userId" as subject from lms_identity.credential_versions v join lms_identity.account a on a.id=v.account_id order by v.account_id loop
  perform lms_private.append_lineage(lms_private.lineage_payload('credential-baseline',item.version,item.subject,item.account_id,item.version,null,null,null,'adopted-baseline',clock_timestamp()));
 end loop;
 for item in select * from lms_identity.credential_events order by occurred_at,id loop
  perform lms_private.append_lineage(lms_private.lineage_payload('credential-event',item.id,item.subject_id,null,null,item.operation_id,null,null,item.action,item.occurred_at));
 end loop;
 for item in select * from lms_private.recovery_events order by occurred_at,id loop
  perform lms_private.append_lineage(lms_private.lineage_payload('recovery-event',item.id,item.subject_id,null,null,null,item.case_id,item.operator_id,item.action,item.occurred_at));
 end loop;
end; $$;

create function lms_private.capture_lineage() returns trigger language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 if tg_table_name='credential_versions' then
  if tg_op='DELETE' then
   perform lms_private.append_lineage(lms_private.lineage_payload('credential-deleted',gen_random_uuid(),null,old.account_id,old.version,null,null,null,'removed',clock_timestamp()));
   return old;
  end if;
  select "userId" into subject from lms_identity.account where id=new.account_id;
  perform lms_private.append_lineage(lms_private.lineage_payload('credential-version',new.version,subject,new.account_id,new.version,null,null,null,'version-recorded',clock_timestamp()));
 elsif tg_table_name='credential_events' then
  perform lms_private.append_lineage(lms_private.lineage_payload('credential-event',new.id,new.subject_id,null,null,new.operation_id,null,null,new.action,new.occurred_at));
 else
  perform lms_private.append_lineage(lms_private.lineage_payload('recovery-event',new.id,new.subject_id,null,null,null,new.case_id,new.operator_id,new.action,new.occurred_at));
 end if;
 return new;
end; $$;
revoke all on function lms_private.capture_lineage() from public,lms_app,lms_auth_service;
create trigger lineage_version after insert or update or delete on lms_identity.credential_versions for each row execute function lms_private.capture_lineage();
create trigger lineage_credential_event after insert on lms_identity.credential_events for each row execute function lms_private.capture_lineage();
create trigger lineage_recovery_event after insert on lms_private.recovery_events for each row execute function lms_private.capture_lineage();
