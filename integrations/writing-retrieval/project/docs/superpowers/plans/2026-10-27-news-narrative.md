# News Narrative Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved five-blueprint news pilot with explicit material placement and dependency-aware writing.

**Architecture:** Add a typed, live Obsidian blueprint layer. Hydrate compact model recommendations into canonical ordered beats; the server renders missing material and dependent observations at their planned positions. Preserve the existing non-news protocol and public Markdown/export fields.

**Tech Stack:** Existing Node/React/YAML, SQLite/Haystack/FastEmbed, single-pass DeepSeek/Humanizer. No new service or npm dependency.

**Spec:** `docs/superpowers/specs/2026-10-27-news-narrative-design.md` (user approved via “按方案实施”).

## Global Constraints

- Write only five new blueprint notes under `叙事蓝图/资讯/`; keep original notes, v5 analyses and 27 structures intact.
- No `全文拆解v6`, no server deployment, no automatic paid DeepSeek tests.
- Keep Figma layout and original Sites starter files intact.
- Recommendation and writing/revision each remain one provider call; Humanizer stays inline.
- Use the current live Vault with digest invalidation; never use a frozen export as runtime source.
- Native execution in the current workspace follows the user's explicit instruction to implement. The workspace is not a Git repository, so no artificial commits/worktree setup.

## Review Focus

- URL-only references must not become available evidence or allow image/video observations.
- A complete evidence set may yield a valid draft with no placeholders.
- Blueprint edits/deletions invalidate old recommendations and do not alter the article count.
- Manual edits and legacy drafts remain readable; AI revision must not silently discard user text.
- Canonical order, coverage and missing-material dependencies must reject the demonstrated tail-placeholder bad fixtures without another paid call.

---

### Task 1: Typed blueprint notes and parser

**Files:** Create `server/blueprints.mjs`, `tests/blueprints.test.mjs`, `knowledge/news-blueprint-pilot/` (authoring fixtures only); modify `server/obsidian.mjs`.

**Interfaces:** `parseBlueprint(note) -> blueprint` with `id,revision,genre,structureId,name,fit,needs,boundary,observed,sourceArticleIds,nodes[]`. Each node has question/move/transition/evidence and ordered beats; material beats carry kind/role/required, observation beats depend on prior material IDs. Live library adds `blueprints[]` and `stats.blueprints`.

- [x] Write tests for editable Markdown parsing, invalid/future dependencies, duplicate beat IDs, missing/invalid notes, live update/delete and unchanged article/template counts.
- [x] Run failing tests, implement the parser and loader classification before article/ordinary-note routing, then verify.
- [x] Author the five source-grounded Markdown fixtures, validate them, and copy them to new Vault paths only without overwriting existing content.

### Task 2: Live retrieval and complete blueprint hydration

**Files:** Modify `server/rag-documents.mjs`, `server/rag/worker.py`, `server/haystack-knowledge.mjs`, `server/knowledge.mjs`; extend relevant retrieval tests.

**Interfaces:** Manifest has `blueprint:<id>` sources; retrieve returns ranked full `blueprints[]`, not partial passages. New Python kind `blueprint` is allowed; existing models, hashes and cached vectors stay usable.

- [x] Write tests that only new blueprint sources change the manifest and stale blueprint hits are rejected.
- [x] Add blueprint indexing/retrieval, genre restriction and full-record hydration; keep the lexical-only explicit engine compatible.
- [x] Verify exact source counts and only incremental embedding on the real Vault; do not rebuild existing vectors.

### Task 3: News plan compilation, rendering and API protocol

**Files:** Create `server/news-narrative.mjs`, `tests/news-narrative.test.mjs`, `tests/news-api.test.mjs`; modify `server/api.mjs` and affected legacy news fixtures.

**Interfaces:** `compileNewsPlan(rawPlan,blueprints,references,structureId)` turns `blueprintId,blueprintRevision,nodeInstructions,materialBindings` into canonical nodes/materials. `writableNewsBeats(plan)` selects allowed provider blocks. `renderNewsDraft(output,plan,references)` validates `{title,structureId,sourceIds,blocks:[{beatId,markdown}]}` and returns public Markdown/materialSlots plus versioned narrative metadata.

- [x] Write failing tests for missing/dependent beats, all-provided no-placeholder drafts, unknown refs/beat IDs, URL-only evidence, image/video constraints and preserved order.
- [x] Implement compact news recommendation hydration, one-call generation, frozen plan snapshots and source checks. No-blueprint news recommendation is an explicit error.
- [x] Implement one-call revision: canonical drafts retain strict blocks; changed references may rebind material IDs in the same reply, validated against existing blueprint order. Manually edited/legacy Markdown stays free-text with unverified-layout status and no silent deletion of author prose.
- [x] Require revision plans to match the current blueprint revision and shape; keep non-news schema unchanged.
- [x] Run HTTP tests for recommend→confirm→generate→revise, stale knowledge, no extra calls, legacy drafts and rejection of the known bad fixtures.

### Task 4: Direction cards and draft metadata

**Files:** Modify `src/App.jsx`, `src/styles.css`, `src/workflow.mjs`, `tests/workflow-state.test.mjs` as necessary.

**Interfaces:** Display `direction.narrativePlan.nodes/materials` inline in existing cards. Preserve `draft.narrative` in version storage/revision inputs; show incomplete or manually-unverified state without exposing protocol internals.

- [x] Test metadata survival and manual-edit detection without discarding Markdown.
- [x] Add compact ordered narrative/material/transition display and source links; keep the current confirmation and export flows.
- [x] Verify production build and existing Sites tests; attempt browser verification only through permitted UI tools.

### Task 5: Acceptance and documentation

**Files:** Add a real-Vault mock-provider QA script/report; update README, AGENTS, spec/plan progress and pilot status.

- [x] Run Node/Python suites appropriate to changed retrieval/API behavior.
- [x] Run real Vault + local models + intercepted provider through the news flow; verify five blueprints, live invalidation, material positions and zero paid calls.
- [x] Independently review the integrated change with gpt-6-luna under the user's standing model preference, fix material findings and run targeted regression checks.
- [x] Leave normal localhost services running; record functional evidence and the limit that real DeepSeek prose quality still needs the user's normal trial.

## Self-review

All spec requirements map to the five tasks. Compact provider plans avoid repeating fixed beat/dependency structures; server canonical hydration owns order. Revision reference rebinding changes only material IDs' reference lists, never the blueprint sequence, and consumes the same single revision call. Existing source counts and cache identity remain unchanged. Native execution avoids another approval round for the already-approved implementation.
