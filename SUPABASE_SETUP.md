# Supabase Setup Guide

Follow these steps to set up Supabase for the editable coffee metadata feature.

## 1. Create Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Wait for the project to be provisioned.

## 2. Run Migration

1. In the Supabase Dashboard, go to **SQL Editor**.
2. Copy the contents of `supabase/migrations/001_initial_schema.sql`.
3. Paste and run the script.

## 3. Create Storage Bucket

1. Go to **Storage** in the Supabase Dashboard.
2. Click **New bucket**.
3. Name: `coffee-bags`
4. Enable **Public bucket** (so images can be displayed without auth).
5. Create the bucket.
6. Go to **Policies** for the bucket and add:
   - **Allow public read**: `SELECT` for `anon`
   - **Allow authenticated upload**: `INSERT` for `authenticated`

## 4. Disable Sign-ups (Single Admin)

1. Go to **Authentication** > **Providers**.
2. Under **Email**, turn off **Enable Email Signups**.
3. Only you can create users via the Dashboard.

## 5. Create Admin User

1. Go to **Authentication** > **Users**.
2. Click **Add user** > **Create new user**.
3. Enter your email and a strong password.
4. This user can sign in and edit coffee metadata.

## 6. Get Credentials

1. Go to **Project Settings** > **API**.
2. Copy **Project URL** and **anon public** key for the frontend (`.env`).
3. Copy **service_role** key for the migration script (keep this secret, never commit).

## 7. Run Migration Script

After creating the project and running the SQL migration:

```bash
cp .env.example .env
# Edit .env: add VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
# For migration only: add SUPABASE_SERVICE_ROLE_KEY

node scripts/migrate-to-supabase.js
```
