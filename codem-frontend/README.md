Codemm frontend (Next.js) for the deterministic SpecBuilder + Activity UI.

## Getting Started

- Set `NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:4000`).
- Run the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## SpecBuilder UX

The SpecBuilder chat uses backend `questionKey` values (e.g. `goal:content`, `confirm:topic_tags`, `invalid:difficulty_plan`) to keep the dialogue deterministic and goal-driven instead of relying on parsing question text.

Backend diagrams + contracts live in `Codem-backend/AGENTIC_PLATFORM.md`.
