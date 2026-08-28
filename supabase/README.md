# Supabase setup for Simi Studio

The repository is ready to run without Supabase credentials (local demo mode),
and automatically switches to Supabase Auth and persistence when credentials
are present.

## 1. Create and migrate a project

Create a Supabase project, then run
`migrations/20260828000000_initial_schema.sql` in the Supabase SQL Editor. The
migration creates Auth-linked profiles, preferences, plans, subscriptions,
payment history, quotas, source documents, generation jobs/events, videos,
scenes, asset metadata, usage history, private Storage buckets, indexes,
triggers, and row-level security policies.

Supabase Auth owns email/password identities. Passwords are hashed and managed
inside `auth.users`; Simi never stores plaintext passwords or copies password
hashes into `public` tables.

## 2. Add browser credentials

Copy `frontend/.env.example` to `frontend/.env.local` and replace both values:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

The publishable key is intentionally used in the browser. RLS protects each
user's rows.

## 3. Add backend credentials

Add these values to the repository-root `.env` (never to a frontend file):

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_YOUR_SERVER_KEY
```

The secret key bypasses RLS and must remain server-only. Never prefix it with
`VITE_`, commit it, paste it into client code, or include it in a URL.

## 4. Configure Auth

In Supabase Dashboard → Authentication → URL Configuration, set the local site
URL to `http://localhost:5173` and add the production domain when available.
Choose whether email confirmation is required. The UI handles both immediate
sessions and confirmation-required signups.

## 5. Billing transition

`complete_demo_checkout` is deliberately marked demo-only. It records a test
payment, subscription history, the selected plan, quota reset, and theme. Before
accepting real money, revoke this RPC from `authenticated` and let a verified
payment-provider webhook perform the same updates using the backend secret key.

## Data ownership

All private tables use `auth.uid()` RLS policies. Storage objects must be placed
under a user-prefixed path such as
`USER_UUID/videos/JOB_ID/final.mp4`. The backend also checks bearer tokens before
creating, listing, or opening database-backed jobs and videos.
