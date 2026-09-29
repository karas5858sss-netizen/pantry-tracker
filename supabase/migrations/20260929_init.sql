-- Pantry Tracker Initial Schema
-- Row Level Security enabled on all tables WITHOUT policies:
-- Client anon key cannot access tables directly.
-- All data access is mediated by the backend Edge Function with service role privileges.

-- 1. Users
create table if not exists users (
  telegram_id bigint primary key,
  first_name text,
  username text,
  language_code text default 'ru',
  timezone text not null default 'Europe/Moscow',
  reminder_hour smallint not null default 9 check (reminder_hour between 0 and 23),
  reminders_enabled boolean not null default true,
  can_write_pm boolean not null default false,
  created_at timestamptz default now()
);

-- 2. Whitelist of permitted users
create table if not exists allowed_users (
  telegram_id bigint primary key,
  note text
);

-- 3. Pantries
create table if not exists pantries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 4. Pantry members (role: owner or member)
create table if not exists pantry_members (
  pantry_id uuid references pantries(id) on delete cascade,
  user_id bigint references users(telegram_id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz default now(),
  primary key (pantry_id, user_id)
);

-- 5. Pantry invite codes (>=16 chars, max_uses, expires_at)
create table if not exists pantry_invites (
  code text primary key,
  pantry_id uuid references pantries(id) on delete cascade,
  created_by bigint references users(telegram_id),
  expires_at timestamptz not null,
  max_uses int not null default 1,
  uses int not null default 0
);

-- 6. Global products catalog (barcode -> name, source: manual or off)
create table if not exists products (
  barcode text primary key,
  name text not null,
  source text not null default 'manual' check (source in ('manual', 'off')),
  updated_at timestamptz default now()
);

-- 7. Items stored in pantries
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  pantry_id uuid not null references pantries(id) on delete cascade,
  barcode text,
  name text not null,
  expiration_date date not null,
  quantity int not null default 1 check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'consumed', 'discarded')),
  created_by bigint references users(telegram_id),
  created_at timestamptz default now(),
  closed_at timestamptz
);

create index if not exists idx_items_pantry_status_exp on items (pantry_id, status, expiration_date);

-- 8. Reminders deduplication log per user, item, and stage (stages: 1, 2, 3)
create table if not exists reminder_log (
  user_id bigint references users(telegram_id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  stage smallint not null check (stage in (1, 2, 3)),
  sent_at timestamptz default now(),
  primary key (user_id, item_id, stage)
);

-- STRICT SECURITY: Enable RLS on all tables with zero client policies
alter table users enable row level security;
alter table allowed_users enable row level security;
alter table pantries enable row level security;
alter table pantry_members enable row level security;
alter table pantry_invites enable row level security;
alter table products enable row level security;
alter table items enable row level security;
alter table reminder_log enable row level security;
