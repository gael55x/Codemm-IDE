# Evaluation

Codem evaluates outputs at multiple boundaries. Each boundary exists because it catches a different class of failure.

## 1) Spec evaluation (contracts + invariants)

The spec-building loop produces a draft spec that evolves across turns.

Evaluation here means:

- enforce fixed fields and language constraints
- validate draft schemas (partial specs are allowed, invalid fields are rejected)
- gate readiness for generation (full spec schema must pass)

This is what prevents ambiguous user intent or LLM hallucinations from becoming invalid generation inputs.

## 2) Generation evaluation (contract + Docker verification)

Generation produces `GeneratedProblemDraft` objects that include a reference artifact.

Evaluation here means:

- contract validation:
  - required fields exist and meet constraints
  - test suites follow required structures (e.g., exactly 8 tests)
- Docker verification:
  - the reference artifact compiles/runs under sandbox rules
  - the reference artifact passes the generated tests

Only after both succeed is a problem eligible for persistence (and even then, the reference artifact is discarded).

## 3) Submission evaluation (judge)

`/submit` runs user code against a test suite in Docker.

Evaluation here means:

- enforce request and file constraints
- run the judge adapter
- report results (passed/failed tests, output, timing)

If authenticated and linked to an owned activity problem, submission outcomes can also update deterministic learner-profile signals (see `feedback.md`).

## Why evaluation is layered

Layering avoids overload:

- spec evaluation catches structural intent issues early, before generation cost
- generation evaluation prevents broken problems from persisting
- submission evaluation isolates untrusted user code inside the sandbox

