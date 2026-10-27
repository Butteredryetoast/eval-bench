# Obsidian 动态连接实施计划
Goal: 用户维护Obsidian即更新网页检索，无静态导出副本。
Architecture: read-only Markdown/YAML adapter + incremental in-memory index + dynamic API revision guard; existing React settings/status refresh.
Spec: docs/superpowers/specs/2026-10-26-live-obsidian-design.md
Constraints: no vault writes, no static fallback, preserve Figma layout, no model key needed for KB search, user requested Luna agents.
Review Focus: full-corpus vs analyzed distinction, latest version dedup/deletion, corrupt/renamed files, symlink escape, exact source excerpts, stale cached recommendation, metadata counts, model-key independence and scope.

1. Root: inspect real note schemas, write failing temporary-vault tests for live edits/add/delete, classification/quality counts, latest version precedence, no pre2023, missing vault/symlinks. Implement server/obsidian.mjs and integrate server/knowledge.mjs. Use YAML parser; incremental stat scan; preserve original Markdown and source paths.
2. Root: update API dynamic loading/health/search, provenance in examples/prompts, KB revision guard; tests for no-key search/live edits/invalid vault/stale recommendation. Remove old test runtime dependence on static export. Existing corpus integrated smoke test via current Vault, no mutations to it.
3. Luna independent: src/App.jsx/styles/workflow helper addition as needed, settings/search/status auto refresh and Obsidian links; README/env instructions. Consume exact spec contract, do not edit server/tests core. Maintain existing layout and errors. Test via build + focused existing helper tests; root browser verifies.
4. Root: full tests/build, independent fresh Luna review, browser inspect connected status and search real notes without key, isolated temp-vault update test proving live changes. Leave normal preview running; document current local/cloud boundary clearly.

Completion: adapter/API/frontend/docs implemented; 43 tests passed, production build passed, Sites packaging tests passed. Actual 5173 same-origin HTTP connects to the real Vault and searches current source notes without a key. No Vault mutations. Browser visual/click verification could not run because Work browser control is disabled; independent Luna review could not finish because of account usage limits. These are recorded in docs/live-obsidian-qa.md. Normal local preview remains running.
