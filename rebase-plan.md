# Rebase Execution Plan

## Approach: Build From Scratch

Rather than an interactive rebase (which gets messy with splits, squashes, and cherry-picks from a fork), we'll build a clean branch commit-by-commit from `main`.

### Setup

```bash
# Add fork as a remote so we can cherry-pick from it
git remote add fork ~/repos/ai/cohort-004-project-fork
git fetch fork

# Create a new branch from main
git checkout -b course-commits main
```

### Execution

For each target commit below, we apply changes and create a clean commit with the correct message. The method varies:

- **direct** — cherry-pick a single commit, amend the message
- **squash** — cherry-pick multiple commits, squash into one
- **split** — cherry-pick a commit, then selectively stage subsets into separate commits
- **fold** — cherry-pick a commit and fold in changes from another commit
- **fork** — cherry-pick from the fork remote

### Target Commits (38 total)

#### Section 03: Day 1 Fundamentals

| #   | Commit Name                                                     | Method | Source    |
| --- | --------------------------------------------------------------- | ------ | --------- |
| 1   | `03.04.01: Add course star rating system`                       | direct | `0111bd2` |
| 2   | `03.07.01: Add lesson comments with soft-delete and moderation` | direct | `577a82d` |

#### Section 04: Day 2 Steering

| #   | Commit Name                                               | Method     | Source                                                                          |
| --- | --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| 3   | `04.01.01: Add CLAUDE.md with steering instructions`      | direct     | `5e288ba`                                                                       |
| 4   | `04.02.01: Add lesson bookmarks for enrolled students`    | direct     | `c0fe1c3`                                                                       |
| 5   | `04.05.01: Add write-a-skill skill`                       | direct     | `2cdac0d`                                                                       |
| 6   | `04.05.02: Add zod-to-valibot skill and remove CLAUDE.md` | split+fold | `.claude/skills/zod-to-valibot/` from `18eca59` + all of `0ba1d7d`              |
| 7   | `04.05.03: Migrate Zod to Valibot`                        | split      | app changes from `18eca59` (everything except `.claude/skills/zod-to-valibot/`) |

#### Section 05: Day 3 Planning

| #   | Commit Name                                                                 | Method | Source    |
| --- | --------------------------------------------------------------------------- | ------ | --------- |
| 8   | `05.02.01: Add write-a-prd skill`                                           | direct | `ec26d3b` |
| 9   | `05.02.02: Add instructor analytics dashboard PRD`                          | direct | `d593610` |
| 10  | `05.03.01: Add naive multi-phase plan`                                      | direct | `aa592e6` |
| 11  | `05.05.01: Add prd-to-plan skill`                                           | direct | `b1fa4b2` |
| 12  | `05.05.02: Improve plan with tracer bullets`                                | direct | `f58a0ce` |
| 13  | `05.06.01: Instructor analytics Phase 1 — service + route + summary cards`  | direct | `c480c9b` |
| 14  | `05.06.02: Instructor analytics Phase 2 — revenue chart + per-course table` | direct | `a658f4e` |
| 15  | `05.06.03: Instructor analytics Phase 3 — admin access + empty states`      | direct | `b86284f` |

#### Section 06: Day 4 Feedback Loops

| #   | Commit Name                                                     | Method | Source    |
| --- | --------------------------------------------------------------- | ------ | --------- |
| 16  | `06.03.01: Add do-work skill`                                   | direct | `ea4fb35` |
| 17  | `06.04.01: Add in-app notifications PRD and plan`               | direct | `f7a683a` |
| 18  | `06.04.02: Add in-app enrollment notifications for instructors` | direct | `afc9937` |
| 19  | `06.05.01: Add Husky pre-commit hooks with lint-staged`         | direct | `e608069` |
| 20  | `06.07.01: Add coupon redemption notifications plan`            | direct | `b05ab02` |
| 21  | `06.07.02: Update do-work skill with red-green-refactor`        | direct | `a0b5325` |
| 22  | `06.07.03: Add coupon redemption notifications for team admins` | direct | `a4b3ccb` |

#### Section 07: Day 5 RALPH

| #   | Commit Name                                                    | Method | Source              |
| --- | -------------------------------------------------------------- | ------ | ------------------- |
| 23  | `07.03.01: Add admin analytics PRD and plan`                   | direct | `d589fd0`           |
| 24  | `07.03.02: Admin analytics Phase 1 — summary cards via HITL`   | direct | `c897b95`           |
| 25  | `07.05.01: Admin analytics Phase 2 — revenue chart via AFK`    | direct | `306c513`           |
| 26  | `07.08.01: Hook up RALPH to GitHub issues`                     | direct | `45e8f01`           |
| 27  | `07.08.02: Admin analytics Phase 3 — course breakdown table`   | fork   | `5fbd305` from fork |
| 28  | `07.08.03: Change admin analytics default period to 12 months` | fork   | `777221a` from fork |
| 29  | `07.09.01: Update PRD and plan skills to use GitHub`           | direct | `f8d8719`           |

#### Section 08: Day 6 Human-In-The-Loop Patterns

| #   | Commit Name                                                      | Method | Source                                        |
| --- | ---------------------------------------------------------------- | ------ | --------------------------------------------- |
| 30  | `08.02.01: Add prd-to-issues skill`                              | direct | `5527d0b`                                     |
| 31  | `08.03.01: Add gamification PRD`                                 | direct | `587ba10`                                     |
| 32  | `08.03.02: Add XP, streaks, quiz XP, and dashboard gamification` | squash | `ebfe6c9` + `7462241` + `54af3a7` + `31f9f1e` |
| 33  | `08.05.01: Add live-presence-indicator research`                 | direct | `93b11a2`                                     |
| 34  | `08.07.01: Add live presence prototype with Ably`                | direct | `1be908f`                                     |
| 35  | `08.09.01: Add improve-codebase-architecture skill`              | direct | `a357190`                                     |
| 36  | `08.10.01: Add module awareness to write-a-prd skill`            | direct | `c1295dc`                                     |

### Method Details

#### Direct cherry-pick (27 commits)

```bash
git cherry-pick <sha>
git commit --amend -m "XX.YY.ZZ: Title"
```

#### Squash (1 commit: #32)

```bash
git cherry-pick <sha1>
git cherry-pick <sha2> --no-commit
# repeat for additional commits
git commit --amend -m "XX.YY.ZZ: Title"
```

#### Split (commits #6 and #7 — splitting `18eca59`)

```bash
# First, cherry-pick the full commit without committing
git cherry-pick 18eca59 --no-commit

# For commit #6 (skill files + CLAUDE.md removal):
git reset HEAD .  # unstage everything
git add .claude/skills/zod-to-valibot/
git cherry-pick 0ba1d7d --no-commit  # fold in CLAUDE.md removal
git add CLAUDE.md
git commit -m "04.05.02: Add zod-to-valibot skill and remove CLAUDE.md"

# For commit #7 (app migration):
git add .  # stage remaining changes
git commit -m "04.05.03: Migrate Zod to Valibot"
```

#### Fork cherry-pick (commits #26 and #27)

```bash
git cherry-pick fork/<sha>
git commit --amend -m "XX.YY.ZZ: Title"
```

### Ordering Concern

The source commits are already in the correct chronological order matching the course sections, with one exception: `0ba1d7d` (Removed CLAUDE.md) appears between sections 05 and 06 in the original history but needs to be folded into `04.05.02`. This is handled by the split+fold method above.

### Verification

After building all 38 commits:

1. `git log --oneline course-commits` — verify 38 commits with correct naming
2. `git diff course-commits live-run-through` — compare final state (should be identical or very close, except for fork changes that weren't on live-run-through)
3. Run `pnpm type-check` and `pnpm test` on the final state
4. Spot-check a few intermediate commits by checking them out and verifying the app runs

### Rollback

If anything goes wrong:

```bash
git checkout live-run-through  # go back to original
git branch -D course-commits   # delete the attempt
```

The original `live-run-through` branch is never modified.
