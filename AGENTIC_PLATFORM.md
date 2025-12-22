---
config:
  theme: redux
---

# Codemm — Agentic Platform (v1.x)

This diagram reflects the **current backend + agent architecture** in one end-to-end flow:

- **Create Activity (SpecBuilder agent loop)** via `/sessions`
- **Generate Activity** via `/sessions/:id/generate` + SSE progress
- **Run/Judge** via `/run` and `/submit` for **Java + Python**
- **Safety**: reference solutions are Docker-validated and then discarded (never persisted)
- **Observability**: structured progress SSE + optional trace SSE (sanitized, no prompts/raw solutions streamed)

## Single End-to-End Diagram

```mermaid
flowchart TB
  %% =========================================================
  %% CODEMM — FULL AGENTIC PLATFORM (Single End-to-End Diagram)
  %% =========================================================

  %% -------------------------
  %% Frontend
  %% -------------------------
  subgraph FE[Frontend (Next.js)]
    FE_CREATE["Create Activity UI<br/>`Codem-frontend/codem-frontend/src/app/page.tsx`"]
    FE_SOLVE["Activity UI (editor + run/tests)<br/>`Codem-frontend/codem-frontend/src/app/activity/[id]/page.tsx`"]
  end

  %% -------------------------
  %% Backend API surface
  %% -------------------------
  subgraph BE[Backend (Express)]
    BE_SESS["Sessions Router<br/>`src/routes/sessions.ts`"]
    BE_SVC["Session Service<br/>`src/services/sessionService.ts`"]
    BE_RUN["POST /run<br/>`src/server.ts`"]
    BE_SUB["POST /submit<br/>`src/server.ts`"]
    BE_ACT["GET /activities/:id<br/>`src/server.ts`"]
    BE_AUTH["JWT Auth<br/>`src/auth.ts`"]
    BE_DB["SQLite DB (sessions, activities, submissions)<br/>`src/database.ts`"]
  end

  %% -------------------------
  %% LLM + agent core
  %% -------------------------
  subgraph AG[Agent Core (SpecBuilder)]
    AG_FIX["Invariant Enforcer<br/>`ensureFixedFields()`<br/>`src/compiler/specDraft.ts`"]
    AG_COL["Collector buffer keyed by QuestionKey<br/>`getDynamicQuestionKey()`<br/>`src/agent/questionKey.ts`"]
    AG_IR["Intent Resolver<br/>`src/agent/intentResolver.ts`"]
    AG_IR_LANG["Deterministic language gate<br/>- default java if unspecified<br/>- confirm before switching<br/>(fixes language loop)"]
    AG_IR_LLM["LLM call for spec inference<br/>`createCodexCompletion()`<br/>`src/infra/llm/codex.ts`"]
    AG_PARSE["Robust JSON parsing<br/>JSON → JSON5 → jsonrepair<br/>`src/utils/jsonParser.ts`"]
    AG_PATCH["Apply JSON Patch + auto-invalidations<br/>`src/compiler/jsonPatch.ts`"]
    AG_RDY["Readiness + confidence gates<br/>`src/agent/readiness.ts`"]
    AG_PROMPT["Next question generator<br/>`src/agent/promptGenerator.ts`"]
    AG_STATE["Session state machine<br/>DRAFT → CLARIFYING → READY → GENERATING → SAVED/FAILED"]
  end

  %% -------------------------
  %% Generation pipeline
  %% -------------------------
  subgraph GEN[Generation Pipeline]
    GEN_VALIDATE["Validate ActivitySpec (strict contract)<br/>`src/contracts/activitySpec.ts`"]
    GEN_PLAN["Derive ProblemPlan (deterministic)<br/>`deriveProblemPlan()`<br/>`src/planner/index.ts`"]
    GEN_PROGRESS["Publish progress events (SSE buffer)<br/>`src/generation/progressBus.ts`"]
    GEN_SLOT["Per-slot LLM generator + repair prompts<br/>`generateSingleProblem()`<br/>`src/generation/perSlotGenerator.ts`"]
    GEN_CONTRACT["Problem contract validation (strict)<br/>`GeneratedProblemDraftSchema`<br/>`src/contracts/problem.ts`"]
    GEN_JAVA_RULES["Java rules (JUnit 5)<br/>8 tests, no package<br/>`src/contracts/javaRules.ts`"]
    GEN_PY_RULES["Python rules (pytest)<br/>8 tests: test_case_1..8<br/>solve(...) required, no IO/randomness<br/>`src/contracts/pythonRules.ts`"]
    GEN_VALIDATE_REF["Docker validate reference artifact<br/>`validateReferenceSolution()`<br/>`src/generation/referenceSolutionValidator.ts`"]
    GEN_DISCARD["Discard reference_solution/reference_workspace<br/>CRITICAL: never persist"]
    GEN_FALLBACK["Soft fallback (optional, once)<br/>problem_style=return, reduce hard, narrow topics<br/>`src/agent/generationFallback.ts`"]
    GEN_PERSIST["Persist problems_json + create Activity row<br/>`src/services/sessionService.ts`"]
  end

  %% -------------------------
  %% Language layer + Docker sandbox
  %% -------------------------
  subgraph LANG[Language Profiles + Docker]
    LP["Language profiles<br/>executionAdapter + judgeAdapter + generator prompts<br/>`src/languages/profiles.ts`"]
    LJAVA["Java profile<br/>`src/languages/javaAdapters.ts` + `src/languages/javaPrompts.ts`"]
    LPY["Python profile<br/>`src/languages/pythonProfile.ts` + `src/languages/pythonAdapters.ts` + `src/languages/pythonPrompts.ts`"]
    DJAVA["Docker image: `codem-java-judge`<br/>`Dockerfile.java-judge`"]
    DPY["Docker image: `codem-python-judge`<br/>`Dockerfile.python-judge`<br/>sandbox: --network none, --read-only"]
  end

  %% -------------------------
  %% Observability
  %% -------------------------
  subgraph OBS[Observability (No prompts / no hidden solutions)]
    SSE_GEN["SSE: /sessions/:id/generate/stream<br/>structured progress only"]
    SSE_TRACE["SSE: /sessions/:id/trace (optional)<br/>requires CODEMM_TRACE=1"]
    TRACE_SAN["Trace sanitizer drops prompts/raw/reference artifacts<br/>`src/routes/sessions.ts`"]
  end

  %% -------------------------
  %% SpecBuilder message loop wiring
  %% -------------------------
  FE_CREATE -->|"POST /sessions"| BE_SESS
  BE_SESS --> BE_SVC
  BE_SVC --> BE_DB
  BE_SVC --> AG_STATE

  FE_CREATE -->|"POST /sessions/:id/messages"| BE_SESS
  BE_SESS --> BE_SVC
  BE_SVC --> AG_FIX --> AG_COL
  AG_COL --> AG_IR
  AG_IR --> AG_IR_LANG
  AG_IR -->|if not language-only| AG_IR_LLM --> AG_PARSE --> AG_PATCH
  AG_IR_LANG --> AG_PATCH
  AG_PATCH --> AG_RDY --> AG_PROMPT
  AG_PROMPT --> BE_DB
  BE_DB --> AG_STATE
  BE_SESS --> FE_CREATE

  %% -------------------------
  %% Generation trigger + progress SSE
  %% -------------------------
  FE_CREATE -->|"SSE /sessions/:id/generate/stream"| SSE_GEN
  FE_CREATE -->|"POST /sessions/:id/generate (auth)"| BE_SESS
  BE_SESS --> BE_AUTH --> BE_SVC
  BE_SVC --> AG_STATE
  BE_SVC --> GEN_VALIDATE --> GEN_PLAN --> GEN_PROGRESS --> SSE_GEN
  GEN_PLAN --> GEN_SLOT --> AG_PARSE --> GEN_CONTRACT
  GEN_CONTRACT --> GEN_JAVA_RULES
  GEN_CONTRACT --> GEN_PY_RULES
  GEN_CONTRACT --> GEN_VALIDATE_REF
  GEN_VALIDATE_REF --> LP --> DJAVA
  GEN_VALIDATE_REF --> LP --> DPY
  GEN_VALIDATE_REF -->|fail (retry up to 3)| GEN_SLOT
  GEN_VALIDATE_REF -->|slot fails after retries| GEN_FALLBACK --> GEN_PLAN
  GEN_VALIDATE_REF -->|pass| GEN_DISCARD --> GEN_PERSIST --> BE_DB --> AG_STATE
  GEN_PERSIST --> SSE_GEN

  %% -------------------------
  %% Activity fetch + learner execution/judging
  %% -------------------------
  FE_SOLVE -->|"GET /activities/:id (auth)"| BE_ACT --> BE_AUTH --> BE_DB
  BE_DB --> FE_SOLVE

  FE_SOLVE -->|"POST /run (no auth required)"| BE_RUN --> LP
  LP --> LJAVA --> DJAVA
  LP --> LPY --> DPY
  BE_RUN --> FE_SOLVE

  FE_SOLVE -->|"POST /submit (optional auth)"| BE_SUB --> LP
  BE_SUB --> BE_DB
  BE_SUB --> FE_SOLVE

  %% -------------------------
  %% Optional trace stream (sanitized)
  %% -------------------------
  FE_CREATE -->|"SSE /sessions/:id/trace"| SSE_TRACE --> TRACE_SAN --> FE_CREATE
```

### Notes

- Spec invariants are enforced by `ensureFixedFields()` (`version`, `test_case_count=8`, and language-specific `constraints`).
- Python generation currently supports **starter_code + reference_solution** (no workspace mode).
- Progress SSE (`/sessions/:id/generate/stream`) and trace SSE (`/sessions/:id/trace`) do **not** stream prompts or hidden reference artifacts.
