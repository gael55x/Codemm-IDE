---
config:
  theme: redux
---

# Codemm — Agentic Platform (v1.x)

This document captures the current “agentic, but deterministic” system design:

- **SpecBuilder** (`/sessions`): 1 LLM call per user turn proposes a partial `ActivitySpec` patch; deterministic reducers apply patches, enforce Zod schemas/invariants, and pick the next question.
- **Generation** (`/sessions/:id/generate`): deterministic plan → per-slot generation → strict contracts → Docker validation → persist (reference artifacts discarded).
- **Execution/Judging**: `/run` (Java/Python/C++) and `/submit` (Java/Python/C++/SQL) inside Docker.
- **Guided Mode**: scaffolding is derived deterministically from validated reference artifacts; tests never change.
- **Observability**: progress SSE + optional sanitized trace SSE (no prompts/raw generations/reference artifacts streamed).

## Single End-to-End Diagram

```mermaid
flowchart TB
  %% Frontend
  subgraph FE["Frontend (Next.js)"]
    FE_CREATE["Create Activity UI<br/>Codem-frontend/codem-frontend/src/app/page.tsx"]
    FE_SOLVE["Solve UI (editor + run/tests)<br/>Codem-frontend/codem-frontend/src/app/activity/[id]/page.tsx"]
  end

  %% Backend
  subgraph BE["Backend (Express)"]
    API_SESS["/sessions router<br/>src/routes/sessions.ts"]
    SVC_SESS["SessionService<br/>src/services/sessionService.ts"]
    API_RUN["POST /run<br/>src/server.ts"]
    API_SUB["POST /submit<br/>src/server.ts"]
    API_ACT["GET /activities/:id<br/>src/server.ts"]
    DB["SQLite<br/>src/database.ts"]
  end

  %% SpecBuilder (turn loop)
  subgraph SB["SpecBuilder (per message)"]
    FIX["ensureFixedFields()<br/>src/compiler/specDraft.ts"]
    PRE["Deterministic pre-parsers<br/>e.g. difficulty_plan shorthand<br/>src/agent/difficultyPlanParser.ts"]
    DLG["DialogueService (1 LLM call/turn)<br/>src/services/dialogueService.ts"]
    CONF["Hard-field confirmation gate<br/>src/agent/fieldCommitmentPolicy.ts"]
    PATCH["applyJsonPatch() + draft validation<br/>src/compiler/jsonPatch.ts<br/>src/compiler/specDraft.ts"]
    GAPS["Spec gaps → next question<br/>src/agent/specAnalysis.ts"]
    COMM["Commitments (persisted)<br/>src/agent/commitments.ts"]
  end

  %% Generation
  subgraph GEN["Generation Pipeline"]
    SPECV["Validate ActivitySpec<br/>src/contracts/activitySpec.ts"]
    PLAN["Derive ProblemPlan<br/>src/planner/index.ts"]
    SLOT["Per-slot generator + repair prompts<br/>src/generation/perSlotGenerator.ts"]
    PROBV["Problem contract validation<br/>src/contracts/problem.ts"]
    DOCKER["Docker validate reference artifact<br/>src/generation/referenceSolutionValidator.ts"]
    SCAFF["Guided scaffolding from reference (deterministic)<br/>src/generation/scaffolding.ts"]
    DISC["Discard reference artifacts (never persist)"]
    PERSIST["Persist Activity problems<br/>src/services/sessionService.ts"]
  end

  %% Judges
  subgraph J["Docker Judge Images"]
    JJAVA["codem-java-judge"]
    JPY["codem-python-judge"]
    JCPP["codem-cpp-judge"]
    JSQL["codem-sql-judge"]
  end

  %% Streams
  SSE_PROG["SSE: /sessions/:id/generate/stream"]
  SSE_TRACE["SSE: /sessions/:id/trace (optional)"]

  %% Create session + chat turns
  FE_CREATE -->|"POST /sessions"| API_SESS --> SVC_SESS --> DB --> FE_CREATE
  FE_CREATE -->|"POST /sessions/:id/messages"| API_SESS --> SVC_SESS --> FIX --> PRE --> DLG --> CONF --> PATCH --> COMM --> GAPS --> SVC_SESS --> DB --> FE_CREATE
  API_SESS --> SSE_TRACE

  %% Generate activity
  FE_CREATE -->|"POST /sessions/:id/generate (auth)"| API_SESS --> SVC_SESS --> SPECV --> PLAN --> SLOT --> PROBV --> DOCKER --> SCAFF --> DISC --> PERSIST --> DB --> FE_CREATE
  PLAN --> SSE_PROG

  %% Solve activity + run/judge
  FE_SOLVE -->|"GET /activities/:id (auth)"| API_ACT --> DB --> FE_SOLVE
  FE_SOLVE -->|"POST /run"| API_RUN --> JJAVA
  API_RUN --> JPY
  API_RUN --> JCPP
  FE_SOLVE -->|"POST /submit"| API_SUB --> JJAVA
  API_SUB --> JPY
  API_SUB --> JCPP
  API_SUB --> JSQL
```

## SpecBuilder Turn Loop (Chat → `ActivitySpec`)

```mermaid
flowchart TB
  U["User message"] --> SVC["processSessionMessage()<br/>src/services/sessionService.ts"]
  SVC --> FIX["ensureFixedFields()<br/>src/compiler/specDraft.ts"]
  FIX --> PRE["Deterministic pre-parsers<br/>src/agent/difficultyPlanParser.ts"]
  PRE --> DLG["runDialogueTurn()<br/>src/services/dialogueService.ts"]
  DLG --> CONF{"Hard-field confirmation required?"}
  CONF -- yes --> PEND["Persist pending patch<br/>session_collectors.buffer_json<br/>questionKey=confirm:*"]
  PEND --> RESP1["Return confirm prompt"]
  CONF -- no --> APPLY["applyJsonPatch() + ActivitySpecDraftSchema<br/>src/compiler/jsonPatch.ts<br/>src/compiler/specDraft.ts"]
  APPLY --> COMM["Upsert commitments<br/>src/agent/commitments.ts"]
  COMM --> GAPS["analyzeSpecGaps() + defaultNextQuestionFromGaps()<br/>src/agent/specAnalysis.ts"]
  GAPS --> RESP2["Return nextQuestion + questionKey + done"]
```

## Deterministic Boundaries (Rules of the Road)

- LLM output is never trusted directly:
  - it’s parsed/validated, then translated into deterministic patch operations
  - invalid fields are never persisted
- Tests do not adapt to scaffolding; verification remains strict:
  - Docker is the safety boundary for generation
  - `/submit` is the safety boundary for learner code
- No chain-of-thought is stored or streamed:
  - trace/progress streams are structured and sanitized

