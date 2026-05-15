-- Per-user monthly + global daily counters for the remove.bg proxy.
-- Only the service role (proxy) writes to these tables.

create table if not exists public.bg_removal_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

create table if not exists public.bg_removal_usage_global (
  day text primary key,
  count int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.bg_removal_usage enable row level security;
alter table public.bg_removal_usage_global enable row level security;
-- No policies → deny-all for anon/authenticated. Service role bypasses RLS.

create or replace function public.increment_bg_usage(
  p_user_id uuid,
  p_month text,
  p_day text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.bg_removal_usage (user_id, month, count, updated_at)
    values (p_user_id, p_month, 1, now())
    on conflict (user_id, month)
    do update set count = bg_removal_usage.count + 1, updated_at = now();

  insert into public.bg_removal_usage_global (day, count, updated_at)
    values (p_day, 1, now())
    on conflict (day)
    do update set count = bg_removal_usage_global.count + 1, updated_at = now();
end;
$$;

revoke all on function public.increment_bg_usage(uuid, text, text) from public;
-- Only the service role calls this; explicit grant not needed since service role bypasses.
