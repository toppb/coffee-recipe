-- Profiles table for username-based routing
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  created_at timestamptz default now()
);

-- Username: 3–30 chars, lowercase alphanumeric + hyphens/underscores, no leading/trailing special chars
alter table profiles add constraint username_format
  check (username ~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$');

alter table profiles enable row level security;

-- Anyone can read profiles (needed for resolving usernames → user_ids)
create policy "Public read profiles" on profiles
  for select using (true);

-- Users can only insert/update their own profile
create policy "Users insert own profile" on profiles
  for insert with check (auth.uid() = id);

create policy "Users update own profile" on profiles
  for update using (auth.uid() = id);

-- Fast username lookups for routing
create index profiles_username_idx on profiles (username);
