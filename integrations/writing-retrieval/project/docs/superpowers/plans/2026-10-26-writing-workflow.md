# Figma 选题与写作实施计划

Goal: 按用户原型实现可用选题池和DeepSeek驱动结构推荐/文章写作。
Architecture: React19/Vite6.4 starter frontend + same-origin Node ESM API + read-only compact knowledge package + localStorage workspaces. No cloud publish.
Stack: React, Vite, Phosphor icons, Node built-in HTTP/fetch/test, Python standard library exporter.
Spec: docs/superpowers/specs/2026-10-26-writing-workflow.md
Global Constraints: Preserve starter hosting files, old data and site; no keys in frontend; no fabricated model output; use Luna for subagents per user's standing preference. No Git repository exists; no commits requested.
Review Focus: cross-filter topic selection; stale confirmed directions; generation/revision source separation; export HTML escaping; untrusted content is data; no missing-key fake success; model calls bounded; user edits versioned; 27-template/1000-article retrieval preserves quality labels.

## Task1 · Knowledge export/retrieval (independent Luna)
Own scripts/export-knowledge.py, knowledge/*, server/knowledge.mjs, tests/knowledge.test.mjs.
Input 结构模板.json plus 文章全文拆解.jsonl and maturity review records. Implement deterministic compact exporter preserving full source titles separately from display title, genre/code/recipe/stages/hook logic/source date/status. Export exactly1000 analyzed records incl non-writing X codes but only27 writing templates. retrieval export loadLibrary() -> {templates,articles,stats}; retrieve({brief,genre,references,preferredStructure},limit=12) -> {templates,examples,stats}, examples.id/title/account/url/reviewStatus plus structure recipe. Exclude X templates from recommendations; filter genre correctly, diversify structures and weight independent QA. Evidence tests must fail before implementation, then pass; do not send full historical bodies as current facts.

## Task2 · DeepSeek API (independent Luna)
Own server/api.mjs, server/deepseek.mjs, server/start.mjs, tests/api.test.mjs; do not edit knowledge.mjs. Consume Task1 contract. Follow exact spec endpoints. createApiServer({library?,retrieve?,apiKey?,baseUrl?,model?,fetchImpl?}) injectable; start.mjs port8787. Validate model JSON, 3 distinct directions constrained to requested genre/available structures and real example ids, source ids subset references. Cache capped recommendations; enforce fingerprint includes all input facts/type; request limits/timeouts, clear configuration/errors. Test actual mock HTTP model including timeout/truncation/invalid output/missingkey/stale input; no model fixture mode in normal production path. Bounded API capacity. Preserve source editing outside this scope.

## Task3 · Frontend (root)
Own src/*, package.json/vite.config, docs, public/assets; localStorage state, topic search/tabs/selection/import/modal, source-matched collapsed conversation shell, dialogs, recommendation cards, confirm→generate→revision, editable draft with versions and export. Read canonical interface above. Install first via bundled Node npm --prefer-offline --no-audit --no-fund. Functional helpers tests meaningful; UI verified in browser rather than mirrored JSX tests. Source screenshots04/02 authoritative; use source no-cover style where real thumbnail assets unavailable, document the difference.

## Task4 · Integrate/verify (root + one fresh Luna review)
Run node --test tests/*.test.mjs; npm run build && npm run test:sites. Start Vite5173 and backend8787; open local browser, exercise realistic user flow with mock model in isolated test server and real data, missingkey normal path. Same-viewport screenshots and design-qa.md. Review implemented files and resolve important defects. Report real paid API unverified until configured, local-only persistence/cloud not deployed. Keep preview running and open for user.
