# SDD ledger — plan: docs/superpowers/plans/2026-10-27-news-narrative.md

User approved the design and implementation scope via “按方案实施”. Native execution; no repeated approval needed.

Ruling: This existing workspace is not a Git repository; use an ordinary durable ledger and tests, without artificial commits/worktrees. Final review uses gpt-6-luna per the user's explicit standing model preference.

Pre-flight: Task 1→2 typed blueprints must not also become articles/ordinary notes. Task 2→3 retrieval must return whole records with content revision. Task 3→4 public Markdown/materialSlots remain compatible, and narrative metadata must survive revision/version storage.

Ruling: Compact recommendations bind materials and adapt node instructions; the server hydrates canonical beat order and dependencies. Revision may update only reference bindings in its single existing model reply; blueprint order remains fixed.

Task 1: in progress — parser and live-source red tests written.

Task 1: complete — parser red→green; npm test 82/82. Five new notes created with exclusive-write preservation of existing files.
Task 2: in progress — manifest/hydration tests observed red, typed blueprint retrieval implemented.

Task 2: complete — manifest/hydration red→green; five live sources incrementally embedded as 28 passages, 6901 sources / 93601 passages; old vectors retained.
Task 3: complete — contract and HTTP red→green; npm test 91/91. Legacy news fixture now tests legacy revision, while current news requires typed blueprints.
Task 4: in progress — metadata survival regression observed red.

Task 4: complete — metadata/manual edit test red→green; npm test 94/94, production build and Sites4/4, Python5/5.
Task 5: in progress — real-Vault QA found template metadata leaking note links into model payload; new path-leak regression observed RED and fixed by explicit structure field projection.
Final review: fresh gpt-6-luna reviewer reported one Important (whole-article revision could omit author text) and one Minor (reference titles not displayed).
Final: fixed manual-draft omission — local paragraph edits are now applied against the original body; untouched prose survives and whole-body resets/ambiguous/overlapping edits fail before replacement. Regression RED→GREEN; final suite pending.
Final: minor (deferred): recommendation material rows show binding status but not individual reference titles; current reference panel remains available.
Final: Ruling: generated prose quality and semantic material sufficiency cannot be judged by intercepted-provider QA — structural checks do not guarantee either; real DeepSeek use remains the author’s normal trial, with no automatic paid experiment.

Final: fixed local-path payload leak — news API regression RED→GREEN with explicit template projection; real-Vault payload assertion also green.
Final verification: npm test 95/95; Python5/5; Sites4/4; production build passed. Real-Vault/local-model/mock-provider two cases passed, 6 intercepted requests / 0 paid requests, no local file paths or Obsidian URLs in provider payloads.
Task 5: complete — real-Vault QA report docs/qa/news-narrative-integration.json; integrated fresh review and fix pass complete; documentation updated. Normal 5173/8787 services started. Browser automation disabled in Work settings, preview open queued; no visual QA claim.
