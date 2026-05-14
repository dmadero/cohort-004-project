# Commit Mapping: Course Lessons → Commits

Starting point: `main` branch
End point: `live-run-through` branch

Commit naming: `XX.YY.ZZ: Title`

## Sources

Commits come from two repos:

- **Main repo**: `live-run-through` branch in this repo
- **Fork repo**: `~/repos/ai/cohort-004-project-fork` (a throwaway fork created during lesson 07.07)
  - To fetch: `git remote add fork ~/repos/ai/cohort-004-project-fork && git fetch fork`
  - Fork commits are used for 07.08 (admin analytics Phase 3 + polish)

## Section 01: Before We Start

No commits. All conceptual/setup lessons. Students start from `main`.

- 01.01 Where We're Going — no commit
- 01.02 Repo Setup — no commit
- 01.03 Playground Walkthrough — no commit
- 01.04 How To Take This Course — no commit
- 01.05 Which Model Should I Use? — no commit
- 01.06 How Big A Subscription Will I Need? — no commit
- 01.07 Navigating The Discord — no commit

## Section 02: Getting To Know Claude Code

No commits. All conceptual/demo lessons.

- 02.01 Managing Your Claude Code Session — no commit
- 02.02 Prompting In The Terminal — no commit
- 02.03 Claude And Your IDE — no commit
- 02.04 Going Forwards And Backwards In Time — no commit
- 02.05 Running Bash Commands — no commit
- 02.06 Permissions — no commit

## Section 03: Day 1 Fundamentals

**Status: CONFIRMED**

- 03.01 The Constraints Of LLMs — no commit
- 03.02 What Are Subagents — no commit
- 03.03 Codebase Exploration — no commit (exploration only, no code produced)
- 03.04 Build A Feature — `03.04.01: Add course star rating system` ← squash from `0111bd2`
- 03.05 Showing Context In The Status Line — no commit
- 03.06 What Is Plan Mode — no commit
- 03.07 The Plan-Execute-Clear Loop — `03.07.01: Add lesson comments with soft-delete and moderation` ← squash from `577a82d`
- 03.08 Compaction — no commit

## Section 04: Day 2 Steering

**Status: CONFIRMED**

- 04.01 What Is An Agents.md File — `04.01.01: Add CLAUDE.md with steering instructions` ← from `5e288ba`
- 04.02 Steering With The Agents.md File — `04.02.01: Add lesson bookmarks for enrolled students` ← from `c0fe1c3` (includes CLAUDE.md updates)
- 04.03 Progressive Disclosure — no commit (conceptual)
- 04.04 What Are Agent Skills — no commit (conceptual)
- 04.05 A Skill For Writing Skills:
  - `04.05.01: Add write-a-skill skill` ← from `2cdac0d`
  - `04.05.02: Add zod-to-valibot skill` ← skill files from `18eca59` + `0ba1d7d` (CLAUDE.md removal folded in)
  - `04.05.03: Migrate Zod to Valibot` ← app changes from `18eca59`
- 04.06 Automatic Memory — no commit

## Section 05: Day 3 Planning

**Status: CONFIRMED**

- 05.01 How To Tackle Massive Tasks — no commit
- 05.02 Write Great PRDs With This Skill:
  - `05.02.01: Add write-a-prd skill` ← from `ec26d3b`
  - `05.02.02: Add instructor analytics dashboard PRD` ← from `d593610`
- 05.03 Split Features Across Multiple Context Windows — `05.03.01: Add naive multi-phase plan` ← from `aa592e6`
- 05.04 What Are Tracer Bullets — no commit
- 05.05 Use Tracer Bullets In Our Multi-Phase Plan:
  - `05.05.01: Add prd-to-plan skill` ← from `b1fa4b2`
  - `05.05.02: Improve plan with tracer bullets` ← from `f58a0ce` (overwrites naive plan)
- 05.06 Executing Our Multi-Phase Plan:
  - `05.06.01: Instructor analytics Phase 1 — service + route + summary cards` ← from `c480c9b`
  - `05.06.02: Instructor analytics Phase 2 — revenue chart + per-course table` ← from `a658f4e`
  - `05.06.03: Instructor analytics Phase 3 — admin access + empty states` ← from `b86284f`

## Section 06: Day 4 Feedback Loops

**Status: CONFIRMED**

- 06.01 Is Code Cheap — no commit
- 06.02 Steering Agents To Use Feedback Loops With Skills — no commit
- 06.03 Building A Do Work Skill — `06.03.01: Add do-work skill` ← from `ea4fb35`
- 06.04 Using Our Do Work Skill:
  - `06.04.01: Add in-app notifications PRD and plan` ← from `f7a683a` (setup)
  - `06.04.02: Add in-app enrollment notifications for instructors` ← from `afc9937` (solution)
- 06.05 Fixing Agents' Broken Formatting With Pre-Commit — `06.05.01: Add Husky pre-commit hooks with lint-staged` ← from `e608069`
- 06.06 What Is Red-Green-Refactor — no commit
- 06.07 Red-Green-Refactor:
  - `06.07.01: Add coupon redemption notifications plan` ← from `b05ab02` (setup)
  - `06.07.02: Update do-work skill with red-green-refactor` ← from `a0b5325`
  - `06.07.03: Add coupon redemption notifications for team admins` ← from `a4b3ccb` (solution)

## Section 07: Day 5 RALPH

**Status: CONFIRMED**

- 07.01 What Is RALPH — no commit
- 07.02 HITL vs AFK RALPH — no commit
- 07.03 Trying HITL RALPH:
  - `07.03.01: Add admin analytics PRD and plan` ← from `d589fd0` (setup)
  - `07.03.02: Admin analytics Phase 1 — summary cards via HITL` ← from `c897b95` (solution)
- 07.04 Sandboxing — no commit
- 07.05 Setting Up And Trying AFK RALPH — `07.05.01: Admin analytics Phase 2 — revenue chart via AFK` ← from `306c513`
- 07.06 Using Backlogs To Queue Tasks For RALPH — no commit
- 07.07 Setting Up Our Repo For GitHub Issues — no commit
- 07.08 Hooking Up RALPH To Your Backlog:
  - `07.08.01: Hook up RALPH to GitHub issues` ← from `45e8f01`
  - `07.08.02: Admin analytics Phase 3 — course breakdown table` ← from fork `5fbd305`
  - `07.08.03: Change admin analytics default period to 12 months` ← from fork `777221a`
- 07.09 Updating Our PRD And Plan Skill To Use GitHub — `07.09.01: Update PRD and plan skills to use GitHub` ← from `f8d8719`

## Section 08: Day 6 Human-In-The-Loop Patterns

**Status: CONFIRMED**

- 08.01 HITL And AFK Tasks — no commit
- 08.02 Don't Plan, Kanban — `08.02.01: Add prd-to-issues skill` ← from `5527d0b` (replaces prd-to-plan skill)
- 08.03 Using The Kanban Skill:
  - `08.03.01: Add gamification PRD` ← from `587ba10` (setup)
  - `08.03.02: Add XP, streaks, quiz XP, and dashboard gamification` ← squash `ebfe6c9` + `7462241` + `54af3a7` + `31f9f1e` (solution)
- 08.04 Research — no commit
- 08.05 Trying Out Research — `08.05.01: Add live-presence-indicator research` ← from `93b11a2`
- 08.06 Prototyping — no commit
- 08.07 Trying Out Prototyping — `08.07.01: Add live presence prototype with Ably` ← from `1be908f`
- 08.08 Designing Codebases AI Loves — no commit
- 08.09 The Improve My Codebase Skill — `08.09.01: Add improve-codebase-architecture skill` ← from `a357190`
- 08.10 Adding Module Awareness To Our Plan/PRD Skill — `08.10.01: Add module awareness to write-a-prd skill` ← from `c1295dc`
