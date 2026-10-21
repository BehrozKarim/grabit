# Grabit

A personal video and audio downloader with a static frontend on Vercel and a separate Python API on Render.

Paste a public video link, choose an available resolution or MP3/M4A audio, and save the prepared file to your phone or computer.

## First working version

- Mobile-first React and TypeScript interface.
- Real format discovery and downloads using yt-dlp.
- MP4/WebM video; MP3 and M4A audio conversion through FFmpeg.
- Queued downloads, track progress, cancellation, and recovery after a page refresh in the same tab.
- Personal access key, exact-origin CORS, and short-lived file links.
- One active operation at a time, with bounded duration, file size, queue length, and execution time.
- Automatic temporary-file cleanup. No database or paid background worker.

The backend accepts YouTube, Facebook, Instagram, TikTok, and X/Twitter links. These are extractor integrations, not a guarantee that every video on each platform works. Private posts, authentication-required content, DRM, live streams, playlists, and multi-video posts are outside this version's scope. Platform changes, region restrictions, or blocked hosting IPs can prevent downloads.

Verified locally: a real 19-second YouTube video downloaded as H.264/AAC MP4 and converted to MP3, with output checked using ffprobe. Other platforms and the Render deployment still need live verification with representative links. Automated API tests use deterministic fixtures rather than third-party websites.

## Project structure

```text
frontend/                   React + TypeScript + Vite; independently deployable
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

Service responsibilities are separated, with small inspector/downloader protocols for dependency injection. HTTP routes do not contain extraction logic, and React components do not construct network requests. Shared validation and formatting live in one place. This keeps the code testable without adding layers that the application does not need.

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

Open [the local app](http://127.0.0.1:5173). The development frontend defaults to the backend at `http://127.0.0.1:8000`. Local development does not require a key when bound to loopback. Never expose this development configuration on a public address; production refuses to start without a sufficiently long access key.

On macOS/Linux, use `.venv/bin/python` instead of `.venv/Scripts/python` and `cp .env.example .env` instead of `Copy-Item`. Run one backend worker, without auto-reload, so the in-memory queue and subprocess lifecycle stay in one process.

## Deployment

### 1. Backend on Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, then select this repository. Render reads the root `render.yaml`.
3. Confirm the service uses the **Free** plan. The blueprint creates one Python web service, with no database or paid worker.
4. Set `GRABIT_ALLOWED_ORIGINS` to a JSON array containing your frontend's exact origin. For initial local testing, use `["http://127.0.0.1:5173","http://localhost:5173"]`. Replace or extend it with the actual Vercel origin after deployment.
5. Deploy, then open the service's `/health` path. It should return `{"status":"ok"}`.
6. In the service's Environment settings, copy the generated `GRABIT_API_KEY` for your own use. Never commit it or put it in a frontend environment variable.

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
| `GRABIT_ALLOWED_ORIGINS` | JSON array of exact allowed frontend origins |

### 2. Frontend on Vercel

1. Import the same GitHub repository into Vercel.
2. Set **Root Directory** to `frontend` and **Framework Preset** to Vite.
3. Set `VITE_API_URL` to your actual Render service origin, for example `https://your-service.onrender.com`. This address is public; it must not contain an access key.
4. Deploy using `npm run build`, with output directory `dist`.
5. Update Render's `GRABIT_ALLOWED_ORIGINS` with the actual Vercel origin and let the backend restart. Preview deployments have different origins; allow them explicitly if needed.
6. Open Grabit on your phone, select **Settings**, enter your Render address and personal access key, then choose **Test & save connection**.

The backend address is remembered in browser local storage. The access key is kept in session storage for that tab; closing the session may require entering it again. No secret is embedded in the frontend bundle. Download links contain a separate 60-second ticket rather than the permanent access key.

### Free-instance defaults

| Limit | Default |
| --- | --- |
| Maximum video length | 20 minutes |
| Maximum finished file size | 150 MiB |
| Active processing | 1 operation |
| Pending + running downloads | 5 |
| Download execution timeout | 10 minutes |
| Ready-file availability | 15 minutes |
| Format cache | 10 minutes |
| Link inspections | 6 per minute |

An input stream is also limited to 150 MiB. Temporary disk usage is checked during download progress and bounded separately to allow audio/video merging. Oversized final files are removed. Choose an existing lower resolution instead of re-encoding video; this service does not upscale or transcode video.

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
