-- Spots initial schema.
-- The server is a per-user sync log: it stores entity envelopes + opaque JSON
-- payloads and never interprets them, except data->>'hash' on photo rows
-- (blob authorization + garbage collection).

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  -- Pulls with a cursor below this horizon get HTTP 410 -> client full resync.
  -- Advanced when tombstones are purged.
  purge_horizon_seq bigint not null default 0
);

-- Global sequence; per-user streams are strictly increasing because pushes
-- are serialized per user with an advisory lock and every write (insert AND
-- update) takes a fresh value.
create sequence if not exists entities_server_seq;

create table if not exists entities (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  created_at bigint not null,
  updated_at bigint not null,
  updated_by text not null,
  deleted boolean not null default false,
  -- Payload is kept on tombstones (cheap, keeps blob GC conservative,
  -- enables future undelete); it is dropped when the tombstone is purged.
  data jsonb,
  server_seq bigint not null default nextval('entities_server_seq')
);

create index if not exists entities_user_seq on entities (user_id, server_seq);
create index if not exists entities_user_type on entities (user_id, type) where not deleted;
create index if not exists entities_photo_hash on entities ((data->>'hash')) where type = 'photo';

create table if not exists blobs (
  hash text primary key,
  size bigint not null,
  created_at timestamptz not null default now()
);
