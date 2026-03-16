-- Replace global auth policies with owner-scoped policies

drop policy if exists "Public read access" on coffees;
drop policy if exists "Authenticated insert" on coffees;
drop policy if exists "Authenticated update" on coffees;
drop policy if exists "Authenticated delete" on coffees;

-- Anyone can read any user's coffees (public canvases)
create policy "Public read access" on coffees
  for select using (true);

-- Only the owner can insert/update/delete their own coffees
create policy "Owner insert" on coffees
  for insert with check (auth.uid() = user_id);

create policy "Owner update" on coffees
  for update using (auth.uid() = user_id);

create policy "Owner delete" on coffees
  for delete using (auth.uid() = user_id);
