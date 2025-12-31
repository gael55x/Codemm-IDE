# Difficulty Planning

Difficulty planning is a core invariant in Codem. It is how the user’s intent (“make it mostly easy”) becomes a deterministic, auditable plan that drives generation.

## Data model

In `ActivitySpec`, difficulty is represented by:

- `problem_count`: integer (Codem v1 supports 1–7)
- `difficulty_plan`: a list of `{ difficulty: "easy"|"medium"|"hard", count: number }`

Key invariants:

- `difficulty_plan` must contain at least one non-zero entry.
- difficulty entries must be unique (no duplicates).
- the sum of all `count` values must equal `problem_count`.

## Why the invariant exists

Codem’s generation pipeline is slot-based:

- each slot corresponds to one problem
- slot difficulty is derived from `difficulty_plan`

If `difficulty_plan` does not sum to `problem_count`, the system cannot deterministically allocate slots.

## Deterministic shorthand parsing

Codem supports parsing common shorthand replies without depending on exact phrasing. Examples:

- `"easy"` / `"all easy"`
- `"easy:2 medium:2"`
- `"2 easy, 1 hard"`
- `"make 4 problems hard"`

Parsing is intentionally conservative:

- if the message does not clearly map to a plan, it is treated as unparsed text and handled by the normal dialogue flow
- when explicit counts are present, the backend may update `problem_count` to match (because the total is explicit)

This preserves determinism while still allowing casual user inputs.

## Interaction with confirmation and commitments

Difficulty planning often changes alongside other hard fields (problem count, language, style). To reduce churn:

- changes may be gated behind explicit confirmation
- once a plan is committed, it is treated as stable unless explicitly changed

See:

- Confirmation gating: `../agentic-design/guardrails-and-validation.md`
- Memory and commitments: `../agentic-design/memory-and-state.md`

