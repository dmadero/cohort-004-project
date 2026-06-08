---
name: do-work
description: Structured end-to-end workflow for implementing a coding task — plan, implement (backend test-first with red-green-refactor, one test at a time; frontend built directly), validate, fix, re-validate, review, then commit. Use when the user asks to build a feature, fix a bug, refactor, or otherwise "do work" / "do the work" and wants it carried through to a validated, committed change or implement a phase form a plan.
---

# Do Work

Carry a coding task from request to committed change through a fixed sequence.
**Never skip Validate or Commit unless the user explicitly says so.**

## Sequence (do not reorder)

Plan → Implement (Red→Green→Refactor) → Validate → Fix Issues → Re-Validate → Review → Commit

## 1. Understand the task

- Understand the task by reading the plan or PRD and the relevant codebase context. Ask questions if something is not clear.

## 2. Plan (optional)

- Write a concise implementation plan (bullets, not prose).
- List: affected files, dependencies/blast radius, risks, and the validation steps you'll run.
- Keep scope to what was requested.

## 3. Implement (test-driven — one test at a time)

**Backend code only.** Apply Red→Green→Refactor to backend logic (server,
data access, business rules, APIs). Do NOT test-drive frontend code (React
components, UI, styling) — build that directly, following conventions.

For backend, build in thin vertical slices (tracer bullets). For each slice, run one
**Red → Green → Refactor** cycle:

- **RED** — write ONE failing test for the next small behavior. Run it; confirm it
  fails for the right reason (not a typo/setup error).
- **GREEN** — write the minimal code to make that one test pass. Nothing extra.
- **REFACTOR** — clean up code and test while green; re-run to confirm still passing.

Rules:

- One test at a time. Don't batch many tests upfront — add the next test only after
  the current cycle is green.
- Start with the thinnest end-to-end slice (tracer bullet) that proves the path,
  then deepen with further cycles.
- Pure refactors: lean on existing tests as the safety net; no new failing test needed.
- Follow existing project conventions (naming, structure, patterns, lint rules). Use
  /standards skill if needed.
- Don't silently re-scope; if something diverges, note it.

## 4. Validate

Run the project's checks.

- **Type check**: `pnpm type check`
- **Tests**: `pnpm run test`

## 5. Fix Issues

- Address every error/failure surfaced by validation. if a failure is unrelated to your changes, flag it to the user rather than ignore it
- Fix the cause, not the symptom; don't disable checks or delete tests to go green.

## 6. Re-Validate

- Re-run the same checks from step 3.
- Loop steps 4–5 until all checks pass, **or** clearly document any remaining blocker
  (what fails, why, what you tried).

## 7. Review

Summarize before committing:

- What changed (files + intent).
- Validation results (pass/fail per check, with output for failures).
- Remaining concerns, assumptions made, and follow-up work.

## 8. Commit

Only after validation passes
