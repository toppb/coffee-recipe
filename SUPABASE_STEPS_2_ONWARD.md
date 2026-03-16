# Supabase Setup: Quick Reference

> **New to Supabase?** Use **SUPABASE_GUIDE.md** instead—it has step-by-step instructions, explanations, and troubleshooting.

You have a project. Follow these steps in order.

---

## Step 2: Run database migration

1. Open your project in the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor**.
3. Open `supabase/migrations/001_initial_schema.sql` in this repo.
4. Copy its contents, paste into the SQL Editor, and run it.
5. Then open `supabase/migrations/002_storage_policies.sql`.
6. Copy and run it as well (create the bucket in Step 3 first if this fails).

---

## Step 3: Create storage bucket

1. Go to **Storage** in the left sidebar.
2. Click **New bucket**.
3. Name: `coffee-bags`.
4. Enable **Public bucket** (images load without auth).
5. Click **Create bucket**.

If step 2’s storage policies failed, go back to SQL Editor and run `002_storage_policies.sql` again.

---

## Step 4: Disable sign-ups

1. Go to **Authentication** → **Providers**.
2. Open **Email**.
3. Turn **off** “Enable Email Signups”.
4. Save.

---

## Step 5: Create admin user

1. Go to **Authentication** → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email and a strong password.
4. Click **Create user**.

---

## Step 6: Get credentials and configure `.env`

1. Go to **Project Settings** (gear icon) → **API**.
2. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** → `VITE_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (for migration only, keep secret).

3. In the project root, create `.env`:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

Use your real values; `.env` is gitignored.

---

## Step 7: Run migration script

From the project root:

```bash
npm install
npm run migrate
```

This will:

- Read `public/data/coffee.json` and `public/recipes/*.md`
- Upload bag images to the `coffee-bags` bucket
- Insert rows into `coffees`

---

## Step 8: Run the app

```bash
npm run dev
```

Then:

1. Open `http://localhost:5173`.
2. Click **Sign in** (top-right).
3. Log in with your admin user.
4. Open a coffee, then click the **✎** (edit) icon to edit metadata.
