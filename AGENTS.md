# TSH Darts League

A single web application: a competitive online darts league site. It is served by a
**zero-dependency Node HTTP server** (`server/index.js`, Node built-ins only) that
exposes a JSON `/api/*` API and serves a vanilla-JS single-page frontend from
`public/` (`public/app.js`, `public/index.html`, `public/styles.css`). Data is
persisted to a JSON file store (`data/db.json`).

## Cursor Cloud specific instructions

### Testing preference

- Only produce visual confirmations (screenshots, screen recordings, or
  `computerUse`/manual UI demos) when the user explicitly requests them.
  Otherwise, verify changes with automated tests (unit + API/end-to-end) and
  logs before committing — the user trusts tested commits without attached
  visuals.
- Note the cloud test browser runs in **UTC**, so single-browser demos of
  timezone-dependent UI can be misleading; prefer API/unit checks for those.

### Services and how to run them

- There is only one service. Start it with `node server/index.js` (same as the
  `start` and `dev` scripts in `package.json`). It listens on `PORT` (default
  `5173`) and `HOST` (default `0.0.0.0`). Health check: `GET /health` → `{"ok":true}`.
- No dependency install is required to run the app — `package.json` declares no
  dependencies and the server imports only Node built-ins. `npm install` is a
  harmless no-op (it only writes an empty `package-lock.json`).

### Non-obvious gotchas

- The JSON data store is the committed seed file itself. Outside Railway (i.e. in
  this VM), `DATA_DIR` is unset, so the server reads and writes `data/db.json`
  **in place**. Any registration/admin action taken while testing mutates the
  committed `data/db.json`. Restore it with `git checkout -- data/db.json` after
  testing. Runtime session state is written to `data/sessions.json`, which is
  gitignored.
- The `src/` directory (React/Vite) and the root-level `vite.config.js`,
  `tailwind.config.js`, `postcss.config.js`, `index.html` are an alternate frontend
  that is **not** wired into the running app. Their dependencies (react, vite, etc.)
  are not declared in `package.json` and are not installed or served. The live
  frontend is the static bundle in `public/`. Do not assume a Vite build step is
  needed to run or deploy the product.
- There is no lint tooling or test-runner framework configured (no ESLint,
  Prettier, Jest, etc.). Some modules ship plain Node test scripts you run
  directly, e.g. `node server/notifications.test.js` and
  `node server/timezones.test.js` (exit non-zero on failure). "Build" is a no-op
  for the served app; validate changes by running the server and exercising the
  UI / `/api/*` endpoints.
- `server/pdcTicker.js` fetches a PDC event ticker from Wikipedia but has built-in
  `FALLBACK_EVENTS`, so `/api/ticker` works even without outbound network access.

### Hello-world smoke test

- Register a player: `POST /api/auth/register` with JSON
  `{"name","email","password","regional","dartcounterName","avg"}`. This creates a
  user + a pending league application and returns a session token. Log in via
  `POST /api/auth/login`; check the session with
  `GET /api/auth/me` (Bearer token). The same flow is available in the UI via the
  "Sign Up" button (multi-step form → Player Hub dashboard).
