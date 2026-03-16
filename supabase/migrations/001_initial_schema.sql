-- Coffees table
create table coffees (
  id uuid primary key default gen_random_uuid(),
  number int unique not null,
  name text not null,
  rating int check (rating between 1 and 5),
  tags text[] default '{}',
  img_url text,
  roaster text default '',
  origin text default '',
  process text default '',
  notes text[] default '{}',
  brew text default '',
  brewer text[] default '{}',
  grinder text[] default '{}',
  recipe_body text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table coffees enable row level security;

-- Anyone can read
create policy "Public read access" on coffees
  for select using (true);

-- Only authenticated users can insert, update, delete
create policy "Authenticated insert" on coffees for insert with check (auth.uid() is not null);
create policy "Authenticated update" on coffees for update using (auth.uid() is not null);
create policy "Authenticated delete" on coffees for delete using (auth.uid() is not null);
