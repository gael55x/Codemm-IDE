# Codemm

## Project Overview

Codemm is an agentic system that turns a short chat into **verified programming activities** (problems + tests), then runs and grades untrusted code in a Docker sandbox.

Core design goal: **determinism at the boundaries**.

- The LLM can propose patches/drafts.
- Deterministic backend code validates, gates, and decides what becomes durable state.
- “Verified” means reference artifacts are validated in Docker; reference artifacts are discarded before persistence.

Repositories:

- Frontend (UI + docs entrypoint): `Codem-frontend` (this repository)
- Backend (agent loop + generation + judge): `https://github.com/gael55x/Codem-backend`

## High-Level Architecture

- **Frontend (Next.js)**: renders the session chat, generation progress, solving UI, auth/profile, and community views.
- **Backend (Express)**:
  - **SpecBuilder**: session loop that turns chat into a validated `ActivitySpec`.
  - **Planner**: deterministic expansion of a validated spec into per-problem “slots”.
  - **Generator**: per-slot LLM drafting + strict contracts + Docker verification.
  - **Judge**: `/run` (execution) and `/submit` (graded) inside Docker per language adapter.
  - **Persistence**: SQLite for sessions, activities, submissions, and learner-profile signals.

## Core Responsibilities

**Frontend**

- Drive sessions and render backend control signals (`questionKey`, `nextQuestion`, `spec` snapshots).
- Stream and render generation progress (SSE).
- Call judge endpoints and render results (`/run`, `/submit`).

**Backend**

- Enforce contracts and invariants (schemas, confirmation/commitment rules, state machine).
- Verify generated reference artifacts in Docker; never persist reference artifacts.
- Sandbox and grade untrusted code in Docker.

## Getting Oriented

**Where to look first**

- Frontend session UI: `src/app/page.tsx`
- Frontend solve UI: `src/app/activity/[id]/page.tsx`
- Backend sessions API: `https://github.com/gael55x/Codem-backend/blob/main/src/routes/sessions.ts`
- Backend orchestration: `https://github.com/gael55x/Codem-backend/blob/main/src/services/sessionService.ts`

**Local development (end-to-end)**

Prereqs: Node.js 18+, npm, Docker (for backend judging).

1) Backend:

```bash
git clone https://github.com/gael55x/Codem-backend.git
cd Codem-backend
cp .env.example .env
./run-codem-backend.sh
```

2) Frontend (new terminal):

```bash
git clone https://github.com/gael55x/Codem-frontend.git
cd Codem-frontend
cp .env.local.example .env
npm install
npm run dev
```

Configure backend URL via `.env`:

- `NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:4000`)

## Documentation Index

**This repo (frontend + integration)**

- Docs home: `docs/index.md`
- Frontend architecture: `docs/architecture.md`
- Client workflows: `docs/data-flow.md`
- Backend API as consumed by the UI: `docs/api/backend.md`

**Backend (authoritative agent + judge design)**

- Docs home: `https://github.com/gael55x/Codem-backend/tree/main/docs`
- Agentic design invariants: `https://github.com/gael55x/Codem-backend/tree/main/docs/agentic-design`
- Backend API reference: `https://github.com/gael55x/Codem-backend/blob/main/docs/api/backend.md`

## Contributing

- Frontend contributing guide: `docs/contributing.md`
- Backend contributing guide: `https://github.com/gael55x/Codem-backend/blob/main/docs/contributing.md`
