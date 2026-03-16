-- Add user_id column to coffees (nullable initially for migration)
alter table coffees add column user_id uuid references auth.users(id) on delete cascade;

-- Drop global uniqueness on number — each user numbers their coffees independently
alter table coffees drop constraint coffees_number_key;

-- Per-user uniqueness on number
alter table coffees add constraint coffees_user_number_unique unique (user_id, number);

-- Fast per-user queries
create index coffees_user_id_idx on coffees (user_id);
