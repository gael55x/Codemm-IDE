# Troubleshooting (Codemm-IDE)

## Docker Not Found

Symptom:

- Dialog shows “Docker Not Found”.

Fix:

- Install Docker Desktop.
- Ensure `docker` is on your PATH.
- Or set `DOCKER_PATH` to your docker binary (common locations):
  - `/opt/homebrew/bin/docker`
  - `/usr/local/bin/docker`
  - `/Applications/Docker.app/Contents/Resources/bin/docker`

## Docker Not Running

Symptom:

- Dialog shows “Docker Not Running”.

Fix:

- Start Docker Desktop and wait until it finishes starting.
- Relaunch `Codemm-IDE`.

## Port Already In Use (3000 or 4000)

Symptom:

- Frontend/backend fails to start.
- Terminal logs show address in use errors.

Fix:

- Start the app with different ports:
  - `CODEMM_BACKEND_PORT=4010 CODEMM_FRONTEND_PORT=3010 npm run dev`

## Frontend Fails With Missing Dependencies

Symptom:

- Frontend process exits; logs show module not found.

Fix:

- From the repo root: run `npm install`.
- Then relaunch: `npm run dev`.

## Backend Fails Building Judge Images

Symptom:

- Backend logs show Docker build errors when starting.

Fix:

- Confirm Docker Desktop has enough resources (CPU/RAM).
- Try rebuilding images:
  - From repo root: `CODEMM_REBUILD_JUDGE=1 npm run dev`

## App Hangs On “Starting…”

Symptom:

- The window stays on the loading screen.

Fix:

- Check terminal logs for `[backend]` and `[frontend]`.
- Confirm these URLs work in a browser:
  - `http://127.0.0.1:4000/health`
  - `http://127.0.0.1:3000/`

## Backend SQLite Error: SQLITE_CANTOPEN (“unable to open database file”)

Symptom:

- Backend logs show `SqliteError: unable to open database file` (often during `/auth/login` or `/auth/register`).

Fix:

- Ensure the SQLite DB lives in a writable location.
  - In the IDE, the backend is launched with `CODEMM_DB_PATH` set to the Electron `userData` directory.
  - If you override it, prefer an absolute path (or use `~`).
- If you previously used the repo-local DB (`apps/backend/data/codem.db`), the IDE will copy it once into `<userData>/codem.db` (only when `CODEMM_DB_PATH` is not explicitly set and the new DB does not exist yet).

## Electron/Chromium Cache Error: “Failed to write the temporary index file”

Symptom:

- Electron logs show `simple_index_file.cc(322) Failed to write the temporary index file`.

Fix:

- Ensure Electron’s storage directories are writable.
  - You can override paths with: `CODEMM_USER_DATA_DIR`, `CODEMM_CACHE_DIR`, `CODEMM_LOGS_DIR`.
