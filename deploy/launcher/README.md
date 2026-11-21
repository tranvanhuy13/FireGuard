# FireGuard launcher

Deploy this directory as a separate Render **Static Site** so it can wake both
web services concurrently before redirecting visitors to the frontend.

Render settings (repository-relative paths):

- Root Directory: `deploy/launcher`
- Build Command: `node build.mjs`
- Publish Directory: `dist`
- Environment: `FRONTEND_URL=https://<frontend-host>` and
  `BACKEND_URL=https://<backend-host>` (origins only, no trailing path).

Deploy the frontend containing `/api/health` and the backend containing the
public cross-origin `/health/ready` response first. Both health endpoints expose
only readiness metadata without credentials. Other API routes retain their
existing CORS configuration. Do not place API keys or deploy hooks
in the static site. Share the static site's HTTPS URL after verifying it.

The launcher checks the FE JSON liveness endpoint and BE `/health/ready`
(including MySQL readiness) concurrently. It requires successful JSON responses,
so Render's HTML cold-start page cannot cause a false success. Each request has
a 15-second timeout; rounds wait 4 seconds, with a 5-minute waiting window and
manual retry. Both services are checked again each round. A suspended service,
failed deployment, CORS error, unavailable database, or exhausted free quota
requires administrator action. This wakes idle deployments; it does not deploy
code or resume administratively suspended services.

Local checks: `node --check build.mjs`, `node --check launcher.js`. Build with
the two public URL variables set, then serve `dist` over HTTP for browser testing.
Do not use a `file://` URL because the page fetches `config.json`.
