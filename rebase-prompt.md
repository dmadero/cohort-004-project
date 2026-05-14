# Task: Build Clean Course Commit History

You need to build a clean git branch called `course-commits` that contains one commit per lesson checkpoint for a course. The mapping of lessons to commits and the execution plan are documented in two files in this repo:

- `commit-mapping.md` — maps each course lesson to its source commit(s)
- `rebase-plan.md` — describes the build-from-scratch approach and methods for each commit type

Read both files thoroughly before starting.

## What You're Doing

You're creating a new branch `course-commits` from `main` with exactly 38 clean commits. Each commit is named `XX.YY.ZZ: Title` corresponding to a lesson in the course. The source commits come from the `live-run-through` branch in this repo, plus 2 commits from a fork at `~/repos/ai/cohort-004-project-fork`.

## Rules

1. **Never modify `main` or `live-run-through`**. You're only creating a new branch.
2. **Follow the commit-mapping.md exactly** for which commits map to which lessons.
3. **Follow the rebase-plan.md exactly** for the method (direct, squash, split, fold, fork) for each commit.
4. **Commit messages** must follow the format `XX.YY.ZZ: Title`. You may add a short description body if the original commit had one.
5. Work through the 38 commits sequentially — don't skip ahead.
6. If a cherry-pick has a conflict, resolve it sensibly and tell me what you did.
7. After all 38 commits are created, verify by:
   - Running `git log --oneline course-commits` to confirm all 38 commits exist with correct names
   - Running `git diff course-commits live-run-through` to compare the final state against the original (differences are expected for fork commits and any reordering of the CLAUDE.md removal)
   - Running `pnpm type-check` and `pnpm test` on the final state to make sure nothing is broken

## Setup

```bash
git remote add fork ~/repos/ai/cohort-004-project-fork
git fetch fork
git checkout -b course-commits main
```

Then start building commits from #1 (`03.04.01`) through #38 (`08.10.01`).
