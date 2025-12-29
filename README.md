# Codemm Frontend

Next.js app for Codemm (the AI activity generator + solver UI).

## Features

- SpecBuilder chat (Practice/Guided)
- Draft activity review + AI edit per problem
- Activity solver UI (run/submit)
- Community feed (`/community`) for browsing shared activities
- Auth + profile pages

## Prerequisites

- Node.js 18+ (recommended)
- Codemm backend running locally or deployed

## Quickstart

```bash
cd codem-frontend
npm install

# optional
cp .env.local.example .env

# run
npm run dev
```

Open `http://localhost:3000`.

## Configuration

- `NEXT_PUBLIC_BACKEND_URL` (default: `http://localhost:4000`)

## Scripts

- `npm run dev` – local dev server
- `npm run build` – production build
- `npm run start` – serve production build
- `npm run lint` – run ESLint

## Repo Layout

- `codem-frontend/src/app` – Next.js App Router pages/routes
- `codem-frontend/src/components` – shared UI components (e.g. onboarding tour)
- `codem-frontend/src/lib` – frontend utilities (SpecBuilder UX helpers, etc.)

