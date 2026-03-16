# Supabase Setup Guide (Beginner-Friendly)

This guide walks you through setting up Supabase so you can edit coffee metadata in your app. Do each step in order.

---

## What You'll Do

1. **Create a table** – Store coffee data (name, rating, tags, etc.)
2. **Create a storage bucket** – Store coffee bag images
3. **Set up security rules** – Everyone can view; only you can edit
4. **Turn off sign-ups** – No one else can create an account
5. **Create your account** – You become the only admin
6. **Copy your project keys** – So the app can talk to Supabase
7. **Run the migration** – Copy your existing data into Supabase
8. **Run the app** – Sign in and edit coffees

---

## Prerequisites

- You already created a Supabase project at [supabase.com](https://supabase.com)
- You're logged in and can see your project dashboard

---

## Step 1: Create the Database Table

**What this does:** Creates a table called `coffees` to store all coffee metadata.

**How to do it:**

1. In the left sidebar, click **SQL Editor** (the `</>` icon).
2. Click **New query**.
3. Copy the SQL below and paste it into the editor (replace any existing text).
4. Click **Run** (or press Cmd/Ctrl + Enter).
5. You should see a green "Success" message.

**SQL to copy:**

```sql
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
```

**If you get an error:** Make sure you copied the entire block. If it says "relation already exists," the table was created earlier—you can skip this step.

---

## Step 2: Create the Storage Bucket for Images

**What this does:** Creates a place to store coffee bag images. It will be "public" so anyone can see the images when browsing your app.

**How to do it:**

1. In the left sidebar, click **Storage** (the folder icon).
2. Click **New bucket**.
3. For **Name**, type exactly: `coffee-bags`
4. Turn **on** the switch for **Public bucket** (so images can be displayed without signing in).
5. Click **Create bucket**.

You should see a new bucket named `coffee-bags` in the list.

---

## Step 3: Add Storage Security Rules

**What this does:** Lets anyone view images, but only you (when signed in) can upload or replace them.

**How to do it:**

1. Go back to **SQL Editor**.
2. Click **New query** again.
3. Copy the SQL below and paste it.
4. Click **Run**.

**SQL to copy:**

```sql
-- Allow public read (anyone can fetch images)
create policy "Public read coffee bags"
on storage.objects for select
using (bucket_id = 'coffee-bags');

-- Allow authenticated upload
create policy "Authenticated upload coffee bags"
on storage.objects for insert
to authenticated
with check (bucket_id = 'coffee-bags');

-- Allow authenticated update (for replacing images)
create policy "Authenticated update coffee bags"
on storage.objects for update
to authenticated
using (bucket_id = 'coffee-bags');
```

**If you get an error about the policy already existing:** You can ignore it or adjust the policy name slightly.

---

## Step 4: Turn Off Sign-ups

**What this does:** Stops anyone else from creating an account. Only you (the admin you'll create next) can sign in.

**How to do it:**

1. In the left sidebar, click **Authentication** (the person icon).
2. Click **Providers** in the submenu.
3. Find **Email** and click it.
4. Find the switch for **Enable Email Signups** and turn it **off** (grey).
5. Click **Save**.

---

## Step 5: Create Your Admin Account

**What this does:** Creates the one user (you) who can sign in and edit coffees.

**How to do it:**

1. In **Authentication**, click **Users**.
2. Click **Add user** (top right).
3. Choose **Create new user**.
4. Enter:
   - **Email:** Your email address
   - **Password:** A strong password (you'll use this to sign in)
5. Click **Create user**.

You should see your new user in the list. Remember this email and password—you'll use them to sign in to the app.

---

## Step 6: Get Your Project Keys

**What this does:** Gives you the URL and keys your app needs to connect to Supabase.

**How to do it:**

1. Click the **gear icon** (Project Settings) in the left sidebar.
2. Click **API** under "Configuration."
3. You'll see:
   - **Project URL** (e.g. `https://abcdefgh.supabase.co`)
   - **Project API keys** with two keys:
     - **anon public** – Safe to use in the frontend
     - **service_role** – Secret; only for the migration script, never expose publicly

4. Click the **copy** icon next to **Project URL** and save it somewhere.
5. Click the **copy** icon next to **anon public** and save it.
6. Click the **copy** icon next to **service_role** and save it (keep this private).

---

## Step 7: Create Your `.env` File

**What this does:** Puts your keys in a file the app and migration script can read. This file is gitignored, so it won't be committed.

**How to do it:**

1. In your project folder (coffee-grid), create a new file named `.env` (with the dot at the start).
2. Paste this template and replace the placeholder values with your real ones:

```
VITE_SUPABASE_URL=paste-your-project-url-here
VITE_SUPABASE_ANON_KEY=paste-your-anon-public-key-here
SUPABASE_SERVICE_ROLE_KEY=paste-your-service-role-key-here
```

**Example** (yours will be different):

```
VITE_SUPABASE_URL=https://xyzabc123.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Tips:**
- No quotes around the values.
- No spaces before or after the `=`.
- The keys are long—copy the whole thing.

---

## Step 8: Run the Migration Script

**What this does:** Copies your existing coffee data (from JSON + recipe files + images) into Supabase.

**How to do it:**

1. Open a terminal in your project folder.
2. Run:

```bash
npm install
npm run migrate
```

3. You should see lines like `Migrated: Drumroaster Coffee Gold Label` for each coffee.
4. At the end: `Migration complete.`

**If you get "Missing SUPABASE_URL" or "Missing SUPABASE_SERVICE_ROLE_KEY":**
- Make sure `.env` exists in the project root.
- Make sure the variable names are exactly `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Restart the terminal and try again.

**If you get a storage or upload error:**
- Confirm the `coffee-bags` bucket exists and is public.
- Re-run the migration scripts from Steps 2 and 3.

---

## Step 9: Run the App and Sign In

**What this does:** Starts the app so you can browse and edit coffees.

**How to do it:**

1. In the terminal, run:

```bash
npm run dev
```

2. Open `http://localhost:5173` in your browser.
3. Click **Sign in** (top right).
4. Enter the email and password you created in Step 5.
5. Click to open any coffee, then click the **✎** (edit) icon to edit its metadata and image.

---

## Quick Reference

| Step | Where in Supabase | What to do |
|------|-------------------|------------|
| 1 | SQL Editor | Run table + RLS SQL |
| 2 | Storage | New bucket `coffee-bags`, Public on |
| 3 | SQL Editor | Run storage policies SQL |
| 4 | Authentication → Providers → Email | Turn off "Enable Email Signups" |
| 5 | Authentication → Users | Add user (your email + password) |
| 6 | Project Settings → API | Copy URL, anon key, service_role key |
| 7 | Project folder | Create `.env` with those values |
| 8 | Terminal | `npm run migrate` |
| 9 | Terminal | `npm run dev`, then sign in |

---

## Troubleshooting

**"Invalid API key" or 401 errors**
- Check that `.env` has the correct keys and no extra spaces.
- Restart the dev server after changing `.env`.

**Can't sign in**
- Confirm "Enable Email Signups" is off (you don't use "Sign up").
- Use the email and password from the user you created in the Dashboard.
- Check Authentication → Users that the user exists.

**Edit button doesn't appear**
- You must be signed in.
- Supabase must be configured (`.env` with valid keys).
- The migration must have run successfully (data in Supabase).

**Images don't load after migration**
- Check that the `coffee-bags` bucket is Public.
- In Storage, open the bucket and confirm the image files are there.
