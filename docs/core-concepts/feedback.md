# Feedback (Deterministic)

In Codem Backend, “feedback” refers to deterministic signals derived from real user behavior that can influence future planning.

This is explicitly not an LLM-driven “reflection” loop. It is a data model + deterministic update rule.

## Learner profile

Codem stores a per-user, per-language learner profile that includes:

- `concept_mastery`: a map of topic → mastery score (`0..1`)
- `recent_failures`: a compact history of failed concepts and recency
- optional `preferred_style`

The profile is:

- updated only via deterministic code paths
- never used to relax safety/verification rules
- used (when enabled) to annotate Guided Mode planning with pedagogy metadata

## Update rule (from submissions)

When a user submits a solution:

- if authenticated
- and the submission references an activity/problem the user owns

the backend can update:

- mastery for the problem’s `topic_tag` (slowly toward `1` on success, toward `0` on failure)
- recent failures list on failure (bounded and deduplicated)

The update rule is intentionally simple and stable; it is not meant to be a full learner-modeling system.

## How feedback is consumed

The planner can use learner-profile signals to:

- select “focus concepts” (topics with lower mastery)
- choose a scaffold curve (more scaffolding early, less later)
- enable/disable optional guided hint injection based on mastery

These influences are additive metadata and must not change the safety semantics of generation or judging.

See:

- Guided pedagogy policy: `../pipelines/feedback.md`
- Planner boundaries: `../agentic-design/planners.md`

