# PencilVid production deployment

This is the Stage 2 operations runbook. It keeps the web service, render
worker, database migrations, and environment secrets independently deployable.

## Architecture

```text
Browser -> HTTPS host -> web container -> Supabase Postgres/Storage
                                      |
                                      v
                                durable job queue
                                      |
                                      v
                              worker container(s)
                                      |
                                      v
                              Supabase private Storage
```

The web container never renders in production. It validates the authenticated
request and reserves quota transactionally, then returns a queued job. Workers
claim jobs with `FOR UPDATE SKIP LOCKED`; all final assets are uploaded to
private Supabase Storage. Local `work/` and `outputs/` are scratch space only.

## 1. Local production image

The production Compose file pins `FFMPEG_BIN=ffmpeg`, `FFPROBE_BIN=ffprobe`,
and defaults `CONTAINER_TTS_BACKEND` to `espeak` inside Linux. This prevents
Windows development paths in `.env` from overriding tools installed in the
image. Only change `CONTAINER_TTS_BACKEND` when that backend and its model are
also installed in the deployment image.

Start Docker Desktop, copy `.env.example` to `.env`, and set real development
credentials. Do not commit `.env`.

```powershell
docker compose -f compose.production.yaml config
docker compose -f compose.production.yaml build
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
Invoke-RestMethod http://127.0.0.1:5000/healthz
Invoke-RestMethod http://127.0.0.1:5000/readyz
```

`/healthz` is a liveness probe and deliberately does not call dependencies.
`/readyz` verifies the frontend build, writable scratch directories, FFmpeg,
FFprobe, TTS, SVG rendering, Postgres access, and the private video bucket.

To stop the stack:

```powershell
docker compose -f compose.production.yaml down
```

## 2. Supabase environments

Use three isolated projects/data sets:

- local development: Supabase CLI on the developer machine;
- staging: a separate hosted project containing synthetic/test data only;
- production: the hosted project containing real users and assets.

Never copy production users or uploaded documents into staging. Configure the
same Auth redirect rules and private buckets in each environment through the
committed migrations.

The existing project was initially migrated in the SQL Editor. Before the
first CLI-managed release, compare the actual schema, then mark only the SQL
files that are already present as applied:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list
supabase migration repair --status applied 20260828000000
supabase migration repair --status applied 20260829000000
supabase migration repair --status applied 20260830000000
supabase db push --dry-run
```

The dry run should show only `20260831000000_production_operations.sql`. Run
this procedure separately for the existing project and only after verifying
the three earlier migrations really are installed. A fresh staging or
production project needs no repair; `supabase db push` applies every migration.

After baselining, all schema changes must be new committed migrations. Never
edit the remote production schema directly in Table Editor or SQL Editor.

## 3. GitHub environments and secrets

In Repository Settings -> Environments, create `staging` and `production`.
Protect `production` with a required reviewer and restrict it to `main`.
Also protect `main` and require every `CI` job before merge.

Add these secrets to each environment:

| Name | Purpose |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI personal access token |
| `SUPABASE_DB_PASSWORD` | Database password for that environment |

Add these non-secret environment variables:

| Name | Purpose |
|---|---|
| `SUPABASE_PROJECT_REF` | Project id from the Supabase dashboard URL |
| `VITE_SUPABASE_URL` | Public project API URL embedded in the frontend |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public browser key embedded in the frontend |
| `VITE_PUBLIC_DEMO_URL` | Optional public 30-second demo clip |
| `VITE_PUBLIC_DEMO_POSTER_URL` | Optional public demo poster |

The `Release` workflow is manual and approval-gated. It performs a database
dry run, applies pending migrations, and publishes an environment-tagged image
plus an immutable commit-SHA image to GitHub Container Registry. It never
places runtime secrets inside the image.

## 4. Hosting-provider runtime secrets

Create one web service and at least one worker service from the same image.
Use the image SHA tag, not `latest`. Give both services the same backend
secrets, but expose a public port only for web.

Required runtime secrets:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (server secret/service role; never `VITE_`)
- `MEDIA_SIGNING_KEY` (unique random value, at least 32 characters)
- every configured LLM provider key used by the director/planner

Required runtime configuration:

```env
APP_ENV=production
JOB_EXECUTION_MODE=queue
USE_STREAMING=0
PORT=5000
ALLOWED_ORIGINS=https://YOUR_DOMAIN
LOG_FORMAT=json
```

Web command (already the Docker image default):

```text
gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 4 --timeout 120 app:app
```

Worker command:

```text
python worker.py
```

Set the platform liveness path to `/healthz` and readiness path to `/readyz`.
Allow workers a long termination grace period so active renders can finish.
Autoscale workers cautiously; the database enforces per-user concurrency, but
provider and host CPU limits still apply.

## 5. Monitoring and alerts

Container logs are JSON on stdout and every web response includes
`X-Request-ID`. Configure the host to retain logs and search by that id.

Production installs the exact versions in `requirements.lock`. Dependency
updates must regenerate that lock, pass CI, and pass the image smoke test before
release; do not let the hosting platform resolve unbounded versions at deploy.

Minimum alerts:

- `/readyz` non-200 for 2 consecutive minutes;
- no `render_workers.last_heartbeat_at` within 90 seconds while queued jobs exist;
- any job in `running` without `heartbeat_at` for 5 minutes;
- queue age over 10 minutes;
- render failure rate over 10% in 15 minutes;
- Supabase database/storage usage over 80%;
- LLM provider error or rate-limit spikes.

Do not expose raw prompts, uploaded document contents, access tokens, or
provider keys in logs. Test alerts in staging before production launch.

## 6. Backups and restore drills

For production, enable Supabase managed daily backups at minimum. If losing up
to one day of user/job data is unacceptable, enable Point-in-Time Recovery.
Storage objects need their own recovery/export policy; database backups do not
constitute an application-level restore test.

Quarterly restore drill:

1. record the latest restorable timestamp and choose a non-production target;
2. restore or duplicate into an isolated recovery project;
3. point a temporary worker/web deployment at the recovery project;
4. verify Auth profiles, plans, quota counters, jobs, videos, and signed assets;
5. record recovery point objective (RPO) and recovery time objective (RTO);
6. delete the isolated recovery environment after evidence is retained.

Never test a restore by overwriting the live production project.

## 7. Release and rollback

1. Merge only after the `CI` workflow passes.
2. Run `Release` for staging and complete an authenticated generate/playback test.
3. Run `Release` for production and approve its protected environment.
4. Deploy the exact GHCR SHA to web, then workers.
5. Verify `/readyz`, sign-in, quota reservation, one render, playback, and logout.

Application rollback means redeploying the preceding immutable SHA. Database
rollbacks must be forward migrations; do not delete an applied migration or
run destructive down scripts against production.
