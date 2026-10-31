-- Better Auth 1.7.14 core schema, isolated from business tables; no plugins or external providers.
create schema lms_identity;
revoke all on schema lms_identity from public;
grant usage on schema lms_identity to lms_auth_service;
create table lms_identity."user" (
 id uuid primary key default gen_random_uuid(), name text not null, email text not null unique,
 "emailVerified" boolean not null default false, image text,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create table lms_identity.session (
 id uuid primary key default gen_random_uuid(), "expiresAt" timestamptz not null, token text not null unique,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
 "ipAddress" text, "userAgent" text, "userId" uuid not null references lms_identity."user"(id) on delete cascade
);
create index identity_session_user on lms_identity.session("userId");
create index identity_session_expiry on lms_identity.session("expiresAt");
create table lms_identity.account (
 id uuid primary key default gen_random_uuid(), "accountId" text not null, "providerId" text not null,
 "userId" uuid not null references lms_identity."user"(id) on delete cascade,
 "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz,
 "refreshTokenExpiresAt" timestamptz, scope text, password text,
 "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
 unique("providerId","accountId")
);
create index identity_account_user on lms_identity.account("userId");
create table lms_identity.verification (
 id uuid primary key default gen_random_uuid(), identifier text not null, value text not null,
 "expiresAt" timestamptz not null, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create index identity_verification_identifier on lms_identity.verification(identifier);
create table lms_identity.rate_limit (
 id uuid primary key default gen_random_uuid(), key text not null unique, count integer not null,
 "lastRequest" bigint not null
);
-- Identity is global to the local host. This trusted service role manages auth rows only.
-- It receives no business, organization, migration, schema-creation or role-administration grants.
alter table lms_identity."user" enable row level security;
alter table lms_identity."user" force row level security;
alter table lms_identity.session enable row level security;
alter table lms_identity.session force row level security;
alter table lms_identity.account enable row level security;
alter table lms_identity.account force row level security;
alter table lms_identity.verification enable row level security;
alter table lms_identity.verification force row level security;
alter table lms_identity.rate_limit enable row level security;
alter table lms_identity.rate_limit force row level security;
create policy identity_user_service on lms_identity."user" to lms_auth_service using(true) with check(true);
create policy identity_session_service on lms_identity.session to lms_auth_service using(true) with check(true);
create policy identity_account_service on lms_identity.account to lms_auth_service using(true) with check(true);
create policy identity_verification_service on lms_identity.verification to lms_auth_service using(true) with check(true);
create policy identity_rate_service on lms_identity.rate_limit to lms_auth_service using(true) with check(true);
grant select,insert,update,delete on all tables in schema lms_identity to lms_auth_service;
revoke all on all tables in schema lms_identity from public,lms_app;
