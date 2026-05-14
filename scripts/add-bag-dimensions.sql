-- Add bag image dimension columns to the coffees table.
-- Run once in the Supabase SQL editor before deploying the dimension-seeding code.

alter table public.coffees
  add column if not exists img_width  integer,
  add column if not exists img_height integer;
