# Grabit

A video and audio downloader with a React frontend on Vercel and a separate Python API on Render or your own computer. A small server-only Vercel function connects the default hosted mode without exposing the Render access key.

Paste a public video link, choose an available resolution or MP3/M4A audio, and save the prepared file to your phone or computer.

## First working version

- Mobile-first React and TypeScript interface.
- Real format discovery and downloads using yt-dlp.
- MP4/WebM video; MP3 and M4A audio conversion through FFmpeg.
- Queued downloads, track progress, cancellation, and recovery after a page refresh in the same tab.
- Hosted mode works immediately, with connection details supplied by the deployment owner.
- Optional local/self-hosted mode connects directly to your own backend.
- Server-only hosted credentials, exact-origin CORS, and short-lived file links.
- One active operation at a time. Render uses explicit resource limits; a default local backend has no application-imposed file-size, video-length, download-time, or lookup-rate cap.
- Automatic temporary-file cleanup. No database or paid background worker.

The backend accepts YouTube, Facebook, Instagram, TikTok, and X/Twitter links. These are extractor integrations, not a guarantee that every video on each platform works. Private posts, authentication-required content, DRM, live streams, playlists, and multi-video posts are outside this version's scope. Platform changes, region restrictions, or blocked hosting IPs can prevent downloads.

Verified locally: a real 19-second YouTube video downloaded as H.264/AAC MP4 and converted to MP3, with output checked using ffprobe. Other platforms and the Render deployment still need live verification with representative links. Automated API tests use deterministic fixtures rather than third-party websites.

## Project structure

```text
frontend/                   React + TypeScript + Vite; independently deployable
  api/backend.ts            Vercel function entry point (small JSON operations only)
  server/                   Server-only hosted backend adapter and tests
  src/components/           Settings, media selection, download status
  src/hooks/                Download state and polling lifecycle
  src/lib/                  API client and display formatting
backend/                    FastAPI + yt-dlp + FFmpeg; independently deployable
  app/main.py               HTTP routes, authentication, CORS, application lifecycle
  app/media.py              Metadata discovery and expiring cache
  app/jobs.py               Job scheduling, cancellation, file access and expiry
  app/downloader.py         Platform extraction and format selection
  app/process.py            Bounded subprocess execution and termination
  tests/                    API, queue, validation, subprocess and FFmpeg checks
render.yaml                 Free Render web-service blueprint
.github/workflows/ci.yml    Independent frontend and backend checks
```

Service responsibilities are separated, with small inspector/downloader protocols for dependency injection. HTTP routes do not contain extraction logic, and React components do not construct network requests. Browser code lives in `frontend/src`; the server-only deployment adapter lives in `frontend/server`. All extraction and media processing stays in `backend`. Shared validation and formatting live in one place.

## Local development

Install Node.js 22.12+ (Node 24 recommended), Python 3.12, and FFmpeg/ffprobe on your PATH. Python 3.10 is supported by this lockfile but deprecated upstream by yt-dlp; use 3.12 for new environments. No third-party API subscription is required.

In a terminal at the repository root, set up the backend:

```powershell
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.lock
Copy-Item .env.example .env
.venv/Scripts/python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

In a second terminal at the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open [the local app](http://127.0.0.1:5173). Vite provides a development version of the hosted adapter, pointing at `http://127.0.0.1:8000` by default. No frontend environment file or key is needed for this local setup. Optional overrides are listed in `frontend/.env.example`.

Local development does not require a key when bound to loopback. Never expose this development configuration on a public address; production refuses to start without a sufficiently long access key.

On macOS/Linux, use `.venv/bin/python` instead of `.venv/Scripts/python` and `cp .env.example .env` instead of `Copy-Item`. Run one backend worker, without auto-reload, so the in-memory queue and subprocess lifecycle stay in one process.

## Deployment

### 1. Backend on Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, then select this repository. Render reads the root `render.yaml`.
3. Confirm the service uses the **Free** plan. The blueprint creates one Python web service, with no database or paid worker.
4. The blueprint sets `GRABIT_ALLOWED_ORIGINS=[]`: hosted API operations arrive from the Vercel server, so browser CORS access is not required. Prepared files use direct attachment links.
5. Deploy, then open the service's `/health` path. It should return `{"status":"ok"}`.
6. In the service's Environment settings, copy the generated `GRABIT_API_KEY`. Store it as the server-only `GRABIT_BACKEND_API_KEY` in Vercel. Never prefix it with `VITE_` or put it in browser code.

The native Render environment supplies FFmpeg and Node.js. `requirements.lock` installs yt-dlp and its JavaScript challenge dependency. The Python runtime is pinned in the blueprint. The start command deliberately uses one worker and disables access logs containing temporary download tickets.

If creating the service manually instead of using a blueprint, use:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Runtime | Python |
| Plan | Free |
| Build command | `pip install -r requirements.lock` |
| Start command | `uvicorn app.main:create_app --factory --host 0.0.0.0 --port $PORT --workers 1 --no-access-log` |
| Health check | `/health` |
| `PYTHON_VERSION` | `3.12.12` |
| `GRABIT_ENV` | `production` |
| `GRABIT_API_KEY` | A randomly generated secret of at least 24 characters |
| `GRABIT_ALLOWED_ORIGINS` | `[]` for hosted proxy mode; exact frontend origins for direct custom access |
| `GRABIT_MAX_FILE_MB` | `150` |
| `GRABIT_MAX_DURATION_SECONDS` | `1200` |
| `GRABIT_JOB_TIMEOUT_SECONDS` | `600` |
| `GRABIT_INSPECTIONS_PER_MINUTE` | `6` |

### 2. Frontend on Vercel

1. Import the same GitHub repository into Vercel.
2. Set **Root Directory** to `frontend` and **Framework Preset** to Vite.
3. Add these **server-only** environment variables in Vercel:

   | Variable | Value |
   | --- | --- |
   | `GRABIT_BACKEND_URL` | Your actual Render origin, such as `https://your-service.onrender.com` |
   | `GRABIT_BACKEND_API_KEY` | The value of Render's generated `GRABIT_API_KEY` |

   Do not use a `VITE_` prefix. No access key is compiled into the browser bundle. Remove the old `VITE_API_URL` setting if you used an earlier version.

4. Deploy using `npm run build`, with output directory `dist`.
5. Open Grabit and paste a video link. **Grabit hosted** is the default; visitors do not enter any backend address or key.

Hosted metadata lookups, job creation, progress, cancellation and ticket requests pass through `/api/backend`. The adapter forwards only approved JSON operations to the configured backend, adds the access key server-side, and refuses arbitrary destinations or redirects. Video/audio bytes go directly from Render to the browser using a 60-second ticket. They do not pass through a Vercel function.

This removes the connection prompt; it does not create visitor authentication. Everyone who can use the hosted website shares its hosted backend and resource limits.

### 3. Use the hosted frontend with your own backend

1. Clone the repository and start only `backend` as described above.
2. In `backend/.env`, allow the exact origin of the hosted Grabit frontend, for example `GRABIT_ALLOWED_ORIGINS=["https://your-grabit.vercel.app"]`, then restart the backend.
3. Open that website on the **same computer**, select **Settings → Your own backend**, and enter `http://127.0.0.1:8000`. Leave the key empty for a loopback-only development backend.
4. Choose **Test & save connection**. The frontend now talks directly to your backend, bypassing the shared hosted server and its limits. Choose **Grabit hosted** to switch back.

Browsers may request permission for local-network access, and support differs between browsers. The hosted-to-local connection still needs verification in your actual browser; the local application tests are not a substitute for that check. Keep an unauthenticated development backend bound to loopback.

On a phone, `localhost` means the phone itself. To use a backend running on a computer from a phone, provide a reachable HTTPS address and configure authentication and the frontend's exact CORS origin. Plain HTTP LAN addresses are intentionally not accepted by the frontend.

The chosen connection and custom backend address are remembered in local storage. A custom server's key, if needed, stays in that tab's session storage. Hosted credentials remain exclusively in Vercel's server environment.

### Hosted and local defaults

| Limit | Render blueprint | Local/self-hosted defaults |
| --- | --- | --- |
| Maximum video length | 20 minutes | No application cap |
| Maximum finished file size | 150 MiB | No application cap |
| Download execution timeout | 10 minutes | No application cap |
| Link inspections | 6 per minute | No application rate cap |
| Active processing | 1 operation | 1 operation |
| Pending + running downloads | 5 | 5 (configurable) |
| Ready-file availability | 15 minutes | 15 minutes |
| Format cache | 10 minutes | 10 minutes |

The backend owner controls limits through `GRABIT_MAX_FILE_MB`, `GRABIT_MAX_DURATION_SECONDS`, `GRABIT_JOB_TIMEOUT_SECONDS`, and `GRABIT_INSPECTIONS_PER_MINUTE`. **Zero disables each respective cap**; positive values enable it, without the former 500 MiB ceiling. These settings belong to the backend, so switching a browser to custom mode cannot remove a hosted server's policy.

With a finite size cap, input streams are limited too. Temporary disk usage is checked during download progress and bounded separately to allow audio/video merging. Oversized final files are removed. Uncapped local downloads still depend on available disk space, network speed, platform restrictions and the computer staying on. There is no application-imposed daily or monthly download quota.

Choose an existing source resolution instead of re-encoding video; this service does not upscale or transcode video.

Render's free service sleeps after inactivity and can take about a minute to wake. Files and job metadata disappear on restart or redeploy. The app explains these cases and lets you fetch the link again. Free hosting has bandwidth/build limits and can suspend heavy usage. Keep it personal and leave out a payment method if your intent is suspension rather than paid overages. Review [Render's current free-service limits](https://render.com/docs/free).

## Checks

Frontend, from `frontend/`:

```sh
npm run lint
npm test
npm run build
```

Backend, from `backend/` with the virtual environment active:

```sh
python -m ruff check app tests
python -m ruff format --check app tests
python -m pytest -q
```

The real MP3 conversion test is skipped if FFmpeg/ffprobe are unavailable. CI installs them. Unit and integration tests do not require social-platform credentials or network access to third-party platforms.

## Updating extractors

yt-dlp needs regular updates as platforms change. Update the minimum in `backend/pyproject.toml` when necessary, regenerate both lockfiles with [uv](https://docs.astral.sh/uv/), then run the checks and a real download before deploying:

```sh
uv pip compile backend/pyproject.toml --python-version 3.10 --universal --output-file backend/requirements.lock
uv pip compile backend/pyproject.toml --python-version 3.10 --universal --extra dev --output-file backend/requirements-dev.lock
```

Use Conventional Commits, such as `feat(api): add format discovery`, `fix(web): handle expired downloads`, and `chore(deps): update yt-dlp`. Keep backend and frontend changes independently understandable.

Only download content you own or have permission to save.
