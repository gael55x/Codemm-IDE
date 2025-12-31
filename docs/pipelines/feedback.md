# Feedback Pipeline (Deterministic)

This document describes the implemented “feedback loop” in Codem Backend.

The loop is intentionally constrained:

- It does not involve LLM reflection.
- It does not change judging semantics or safety contracts.
- It provides deterministic signals for Guided Mode planning.

## Inputs

The feedback pipeline is triggered by `POST /submit` when all of the following are true:

- the request is authenticated
- `activityId` and `problemId` are provided
- the activity belongs to the authenticated user
- the problem exists within the activity

If any condition fails, no feedback state is updated (judging still occurs).

## Transform

Given a submission outcome:

- Extract a concept key from the problem (`topic_tag`).
- Update the per-user per-language learner profile deterministically:
  - adjust `concept_mastery` slightly toward `1` on success, toward `0` on failure
  - update a bounded list of `recent_failures` on failure

The update rule is stable and intentionally simple to keep behavior explainable.

## Outputs

The learner profile is persisted and may influence Guided Mode planning:

- focus concepts are chosen based on lower mastery
- the planner can annotate slots with scaffold level and learning goals
- guided hint injection may be enabled/disabled based on mastery

See:

- Core feedback concept: `../core-concepts/feedback.md`
- Planner boundaries: `../agentic-design/planners.md`

