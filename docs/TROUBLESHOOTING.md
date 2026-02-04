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

- From `Codemm-frontend/`: run `npm install`.
- Then relaunch `Codemm-IDE`.

## Backend Fails Building Judge Images

Symptom:

- Backend logs show Docker build errors when starting.

Fix:

- Confirm Docker Desktop has enough resources (CPU/RAM).
- Try rebuilding images:
  - From `Codemm-backend/`: `REBUILD_JUDGE=1 ./run-codem-backend.sh`

## App Hangs On “Starting…”

Symptom:

- The window stays on the loading screen.

Fix:

- Check terminal logs for `[backend]` and `[frontend]`.
- Confirm these URLs work in a browser:
  - `http://127.0.0.1:4000/health`
  - `http://127.0.0.1:3000/`

