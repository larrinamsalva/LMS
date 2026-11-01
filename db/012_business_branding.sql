-- Explicit configuration/BuildPlan v2 extension. Historical SQL and rows stay unchanged.
do $$ begin
 if not pg_try_advisory_xact_lock(74021906) then raise exception 'Stop runtime hosts before branding migration' using errcode='55000';end if;
end; $$;
lock table lms.records,lms.config_revisions,lms.build_plan_revisions in access exclusive mode nowait;

create function lms_private.valid_branding_configuration(c jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare b jsonb;
begin
 if jsonb_typeof(c) is distinct from 'object' then return false;end if;
 if c->'schemaVersion'='1'::jsonb then return not(c?'branding');end if;
 if c->'schemaVersion' is distinct from '2'::jsonb then return false;end if;
 b:=c->'branding';
 if jsonb_typeof(b) is distinct from 'object' then return false;end if;
 if exists(select 1 from jsonb_object_keys(b)k where k not in ('version','palette','mark','monogram','tagline','appearance')) then return false;end if;
 if jsonb_typeof(c->'name') is distinct from 'string' or coalesce(length(c->>'name'),0) not between 1 and 80 or c->>'name'<>btrim(c->>'name') or c->>'name' ~ '[<>[:cntrl:]]' then return false;end if;
 if b?'tagline' then
  if jsonb_typeof(b->'tagline') is distinct from 'string' or length(b->>'tagline')>120 or b->>'tagline'<>btrim(b->>'tagline') or b->>'tagline' ~ '[<>[:cntrl:]]' then return false;end if;
 end if;
 return coalesce(b->'version'='1'::jsonb
  and b->>'palette' in ('forest-v1','ocean-v1','plum-v1','copper-v1')
  and b->>'mark' in ('monogram','home','sparkle','leaf','tiles')
  and b->>'appearance' in ('light','dark')
  and jsonb_typeof(b->'monogram')='string' and b->>'monogram' ~ '^[A-Z0-9]{1,4}$',false);
end; $$;
revoke all on function lms_private.valid_branding_configuration(jsonb) from public,lms_app;

-- Refuse unsupported pre-existing adoption; never normalize/rewrite a populated configuration.
do $$ begin
 if exists(select 1 from lms.config_revisions where not lms_private.valid_branding_configuration(document))
  or exists(select 1 from lms.build_plan_revisions where not lms_private.valid_branding_configuration(document->'configuration')) then
  raise exception 'Existing configuration contains unsupported branding; review offline before migration' using errcode='23514';
 end if;
end; $$;
alter table lms.config_revisions drop constraint config_revisions_document_check;
alter table lms.config_revisions add constraint config_revisions_document_check check(jsonb_typeof(document)='object' and coalesce(document->'schemaVersion' in ('1'::jsonb,'2'::jsonb),false));
create function lms_private.configuration_branding_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not lms_private.valid_branding_configuration(new.document) then raise exception 'Unsupported configuration branding' using errcode='23514';end if;
 return new;
end; $$;
revoke all on function lms_private.configuration_branding_guard() from public,lms_app;
create trigger configuration_branding_guard before insert on lms.config_revisions for each row execute function lms_private.configuration_branding_guard();

-- Retain role/actor, epoch, append-only revision, quota, audit and native online guards.
create or replace function lms_private.build_plan_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare prior integer;
begin
 if not lms.has_role(new.organization_id,array['owner','admin']) or new.created_by is distinct from lms.current_user_id() then raise exception 'BuildPlan drafts require owner/admin' using errcode='42501';end if;
 insert into lms_private.record_epochs(organization_id,epoch) values(new.organization_id,1) on conflict(organization_id) do update set epoch=lms_private.record_epochs.epoch+1;
 if new.document->>'format' is distinct from 'lms-build-plan' or not coalesce(new.document->'version' in ('1'::jsonb,'2'::jsonb),false) or new.document->'engineApi' is distinct from '1'::jsonb or new.document->'templateVersion' is distinct from '1'::jsonb or coalesce(new.document->>'template','') not in ('property','cleaning','custom') or not lms_private.valid_branding_configuration(new.document->'configuration') or new.document->'version' is distinct from new.document->'configuration'->'schemaVersion' or exists(select 1 from jsonb_object_keys(new.document)k where k not in ('format','version','engineApi','templateVersion','template','configuration')) then raise exception 'Unsupported BuildPlan envelope or branding' using errcode='23514';end if;
 select max(revision) into prior from lms.build_plan_revisions where organization_id=new.organization_id and id=new.id;
 if new.revision<>coalesce(prior,0)+1 then raise exception 'BuildPlan changed; reload before saving' using errcode='23514';end if;
 if prior is null and (select count(distinct id) from lms.build_plan_revisions where organization_id=new.organization_id)>=5 then raise exception 'Temporary workspace supports five BuildPlans' using errcode='23514';end if;
 new.created_at:=now();
 return new;
end; $$;
revoke all on function lms_private.build_plan_guard() from public,lms_app;
