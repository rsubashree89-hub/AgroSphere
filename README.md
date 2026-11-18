# AgroSphere

AgroSphere is a full-stack farm management application built with React,
TypeScript, Vite, Express, and PostgreSQL. It provides authenticated farm,
field, and crop records, along with weather, irrigation logging, price
observations, notifications, and reports.

## Implemented functionality

- Registration, login, logout, and current-user endpoints using revocable
  HttpOnly JWT session cookies.
- User-scoped farm, field, and crop CRUD, with crop-stage history.
- Responsive dashboard with farm/crop aggregates, recent activity,
  notifications, and crop-stage charts.
- Five-day weather forecasts from Open-Meteo (no API key required); weather
  observations are saved to PostgreSQL.
- Irrigation history with manually entered moisture, or an explicitly labelled
  simulator. Its threshold-based suggestions are not crop-specific advice.
- User-reported market prices. They are not a live market feed.
- Per-user notifications generated transactionally for harvest windows,
  low-moisture readings, severe weather observations, and crop-health findings.
  Harvest-window checks also run at API startup and every six hours.
- Inclusive report date filters with CSV and PDF downloads. CSV text values are
  protected against spreadsheet-formula injection.
- Admin platform overview, user disable/restore, session revocation, and an
  audit trail. Admin role assignment is a one-time CLI bootstrap.
- Optional image-analysis integration through FastAPI and Plant.id. It requires
  separate provider credentials and is unavailable until configured.

## Technology and prerequisites

- Node.js 20.19+ or 22.12+ and npm.
- PostgreSQL 13+ (local development can use PostgreSQL 18).
- Python 3.10+ only if running the optional AI service.

## Local setup

1. Install Node dependencies:

   ```powershell
   npm install
   ```

2. Create the database `agrosphere_db` and ensure PostgreSQL is running on
   `localhost:5432`.
3. Create and locally configure the API environment:

   ```powershell
   if (-not (Test-Path server\.env)) { Copy-Item .env.example server\.env }
   notepad server\.env
   ```

   Set `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and a private
   `JWT_SECRET` of at least 32 characters. Set `AI_SERVICE_URL` only when the
   optional FastAPI service is running. Never commit or share `server/.env`.
4. Apply unapplied migrations. The migration runner uses a PostgreSQL advisory
   lock and per-migration transactions; it does not drop existing tables or
   records:

   ```powershell
   npm run db:migrate
   ```

5. Start the API and frontend in separate terminals:

   ```powershell
   npm run dev:server
   npm run dev
   ```

   The frontend is at `http://localhost:5173`; Vite proxies `/api` requests to
   the API at `http://localhost:4000`.
6. Check service liveness and PostgreSQL readiness:

   ```powershell
   Invoke-RestMethod http://localhost:4000/api/health/live
   Invoke-RestMethod http://localhost:4000/api/health/ready
   ```

The server reads environment variables from `server/.env`. The same
`PG*` variables are used by the migration runner. `.env` files and uploaded
crop-health images are excluded by `.gitignore`.

## Optional crop-health AI service

The AI integration uses Plant.id's health-assessment endpoint; it is not a
local inference model. Without a valid Plant.id API key, analysis returns an
explicit unavailable response and does not claim a diagnosis.

1. Create a Python environment and install dependencies:

   ```powershell
   py -m venv ai-service\.venv
   .\ai-service\.venv\Scripts\Activate.ps1
   pip install -r ai-service\requirements.txt
   ```

2. Create and locally configure the AI-service environment:

   ```powershell
   if (-not (Test-Path ai-service\.env)) { Copy-Item ai-service\.env.example ai-service\.env }
   notepad ai-service\.env
   ```

   Set `PLANT_ID_API_KEY` there. The service loads this file without printing
   the key. Never put the provider key in the browser, `server/.env`, or source
   control. The key must come from a Plant.id account and is never hardcoded.
3. Start the service:

   ```powershell
   uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000
   ```

4. Set `AI_SERVICE_URL=http://localhost:8000` in `server/.env`, then restart the
   Node API. The service endpoints are `/health/live`,
   `/health/ready`, and `/api/v1/health-assessment`. Readiness reports only
   whether a key is configured; it does not validate the key against Plant.id.

The service sends uploaded images to Plant.id for analysis. This repository's
automated tests use a mocked provider response; a valid key, provider account,
network access, and a real image are required to verify the external integration
in your deployment. Provider output is untrusted guidance, and low-confidence
or incomplete results are reported as uncertain.

Uploaded images are stored under `server/storage/crop-health/`; use persistent,
access-controlled storage and a cleanup/retention policy before production
deployment.

## Verification

```powershell
npm test
npm run lint
npm run build
py -m unittest discover -s ai-service\tests -v
```

## API documentation

The OpenAPI 3.1 specification is in [server/openapi.yaml](server/openapi.yaml).
Private routes require the `agrosphere_session` HttpOnly cookie. The API
prefix is `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health/live` | API liveness |
| GET | `/api/health/ready` | PostgreSQL readiness |
| POST | `/api/auth/register` | Register and create a session |
| POST | `/api/auth/login` | Start a session |
| GET | `/api/auth/me` | Current authenticated user |
| POST | `/api/auth/logout` | Revoke the current session |
| GET, POST | `/api/farms` | List or create farms |
| GET, PUT, DELETE | `/api/farms/{farmId}` | Read, update, or delete an owned farm |
| GET, POST | `/api/fields` | List or create fields in owned farms |
| GET, PUT, DELETE | `/api/fields/{fieldId}` | Read, update, or delete an owned field |
| GET, POST | `/api/crops` | List or create crops in owned fields |
| GET, PUT, DELETE | `/api/crops/{cropId}` | Read, update, or delete an owned crop |
| GET | `/api/crops/{cropId}/records` | Crop history |
| GET | `/api/dashboard` | Dashboard aggregates and recent activity |
| GET | `/api/weather/{farmId}` | Open-Meteo conditions and forecast |
| GET, POST | `/api/irrigation` | List or record field irrigation |
| GET, POST | `/api/market-prices` | List or add user-reported prices |
| GET | `/api/notifications` | List the current user's notifications |
| PATCH | `/api/notifications/{notificationId}/read` | Mark an owned notification read |
| GET | `/api/reports/summary?from=&to=` | Date-filtered farm and irrigation summary |
| GET | `/api/reports/export/csv?from=&to=` | CSV report download |
| GET | `/api/reports/export/pdf?from=&to=` | PDF report download |
| GET | `/api/admin/overview`, `/api/admin/users`, `/api/admin/activity` | Admin-only platform and audit summaries |
| PATCH | `/api/admin/users/{userId}/active` | Disable or restore an account; disable revokes sessions |
| GET, POST | `/api/crop-health/{cropId}` | List analyses or submit an image for analysis |

## Production preparation

- Configure a strong private `JWT_SECRET`, production PostgreSQL credentials,
  `APP_ORIGIN`, and HTTPS. Session cookies are marked Secure in production.
- `PGSSLMODE=verify-full` is required in production. PostgreSQL TLS certificate
  verification remains enabled.
- Use a managed PostgreSQL service, run migrations as a controlled deployment
  step, and take tested backups.
- Configure persistent, private image storage and appropriate retention before
  enabling crop uploads.
- Configure a shared rate-limit store when running multiple API instances.
- Configure Plant.id credentials only if the optional provider integration is
  enabled. Review provider terms, privacy, and image-handling requirements.
- Run `npm test`, `npm run lint`, and `npm run build` in CI before deployment.

## First administrator setup

1. Register the account that should receive administrator access.
2. Generate a one-time random value locally, for example:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Set `ADMIN_BOOTSTRAP_SECRET` in the private `server/.env` to that value.
3. Supply the same value to the command as a temporary environment variable
   without placing it in shell history or a command argument, then run:

   ```powershell
   $secure = Read-Host "One-time bootstrap token" -AsSecureString
   $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try {
     $env:ADMIN_BOOTSTRAP_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
     npm run admin:bootstrap -- admin@example.test
   } finally {
     Remove-Item Env:\ADMIN_BOOTSTRAP_TOKEN -ErrorAction SilentlyContinue
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
   }
   ```

   Replace the argument with the already-registered account email. The CLI
   compares the token in constant time, takes a transaction-scoped advisory
   lock, and refuses to run if any admin role already exists. Refresh the
   browser after bootstrap to load the updated role. Remove
   `ADMIN_BOOTSTRAP_SECRET` from `server/.env` after the one-time setup. Never
   bootstrap through a public HTTP endpoint.

## Reports and generated notifications

`GET /api/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` accepts either or both
inclusive date bounds. Farm area is a current snapshot; field/crop creation,
harvest updates, and irrigation totals are filtered to the period.
`GET /api/reports/export/csv` and `/api/reports/export/pdf` download the same
report with optional date bounds.

Database triggers create deduplicated notifications in the same transaction as
low-moisture irrigation records, severe weather observations (at least 20 mm
reported current rainfall or thunderstorm conditions), uncertain/disease image
results, and crops expected to reach harvest within seven days. The API
rechecks approaching harvest windows on startup and every six hours. These
notices are observations and do not replace local weather warnings or
agronomic judgment.

## Production deployment

The repository includes Dockerfiles, a Compose deployment, an Nginx
same-origin reverse proxy, and a GitHub Actions CI workflow. The Compose setup
expects an externally managed PostgreSQL database with TLS enabled; it does not
create, reset, or delete a database. Keep the FastAPI service on the private
Compose network and do not expose it directly to browsers.

### Docker Compose deployment

1. Install Docker Engine with the Compose plugin on the deployment host.
2. Copy `.env.production.example` to `.env.production` on that host and edit
   the copy. Use the host's public HTTPS origin for `APP_ORIGIN`, and provide
   managed PostgreSQL credentials, a verified TLS configuration, and a
   randomly generated `JWT_SECRET`. Do not commit `.env.production`.
3. Ensure DNS and the HTTPS reverse proxy point to the host. The Compose web
   container listens on `APP_PORT` (default `8080`) and should sit behind a
   TLS-terminating reverse proxy. The browser and API share one origin.
4. Build and run the controlled, additive migrations before starting the API:

   ```sh
   docker compose --env-file .env.production build
   docker compose --env-file .env.production run --rm migrate
   docker compose --env-file .env.production up -d api web
   ```

5. Check the deployment:

   ```sh
   docker compose --env-file .env.production ps
   curl --fail http://localhost:8080/api/health/ready
   ```

   Use the actual configured `APP_PORT` when checking locally. Readiness
   requires a successful PostgreSQL connection.
6. To enable the optional Plant.id service, set `AI_SERVICE_URL=http://ai:8000`
   and `PLANT_ID_API_KEY` in `.env.production`, then start with the AI profile:

   ```sh
   docker compose --env-file .env.production --profile ai up -d --build api web ai
   ```

   The key is passed only to the private AI container. Without valid provider
   credentials and provider access, image analysis remains unavailable.
7. Back up the external PostgreSQL database and establish restore procedures.
   The `crop-health-images` volume persists uploaded images on the host; include
   it in access controls, retention, backup, and restore plans.

The Compose file does not configure a cloud provider, DNS, TLS certificates,
managed database, firewall, backups, monitoring, or a shared rate-limit store.
Configure and test those for the chosen host before accepting production
traffic. Run migrations as a release step, not automatically on every API
startup.

### GitHub preparation

The CI workflow runs Node tests, lint, the frontend/API build, and the AI
service unit tests without requiring database or Plant.id credentials. Before
publishing, initialize Git in the project folder (only if this is the intended
repository), inspect the staged files, create an empty GitHub repository, and
add its remote. Never stage `.env`, `.env.production`, `server/.env`, or
`ai-service/.env`; GitHub Actions must receive any future deployment secrets
through GitHub's protected secret settings, not workflow source.

Set production values through the hosting platform's secret manager rather than
committing `.env`:

| Variable | Production guidance |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_PORT` | Port assigned by the hosting platform |
| `APP_ORIGIN` | Exact public HTTPS frontend origin |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | Managed PostgreSQL connection |
| `PGPASSWORD` | Secret-manager value; never in source control |
| `PGSSLMODE` | Must be `verify-full` in production; certificate validation stays enabled |
| `PGSSLROOTCERT` | Optional path to the provider's CA certificate when required |
| `JWT_SECRET` | Secret-manager value, at least 32 characters; rotate deliberately |
| `AI_SERVICE_URL` | Private FastAPI service URL only if crop analysis is enabled |
| `PLANT_ID_API_KEY` | `ai-service/.env` locally or secret manager in production; never in Node/browser code |
| `ADMIN_BOOTSTRAP_SECRET` | Temporary bootstrap-only secret; remove after setup |

Build and apply migrations as controlled release steps:

```powershell
npm ci
npm run lint
npm test
npm run build
npm run db:migrate
```

The build compiles the API to `server/dist/`. Start it with `npm run
start:server`; do not use `tsx watch` in production. Provide graceful process
shutdown, health probes at `/api/health/live` and
`/api/health/ready`, PostgreSQL backups, and monitoring for migration, scheduler,
and provider errors. Multi-instance deployments should use a shared rate-limit
store and verify that the six-hour reminder job is not duplicated operationally
(the database event keys make repeated checks idempotent).

Run migrations in a release job with the Node development toolchain available
(`tsx` is used by the migration command). The runtime image can contain the
compiled `server/dist/`, frontend `dist/`, and production npm dependencies only.
Keep backups and a rollback plan before applying schema changes.

Use persistent private storage with access control and a retention policy for
uploaded images. Configure and test provider billing, quotas, privacy terms, and
network access before enabling Plant.id. No live market-price feed or physical
irrigation sensor is integrated; market observations remain user-reported, and
simulated moisture is explicitly marked as simulation.
