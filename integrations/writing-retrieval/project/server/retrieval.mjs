// Local retrieval only: no network requests, model calls, or Vault writes.
// BM25 ranks passages; RRF combines topic and writing-pattern rankings.
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
const stop = new Set('一个 一种 一些 这个 那个 这些 那些 我们 你们 他们 自己 可以 需要 进行 以及 因为 所以 但是 如果 已经 现在 如何 什么 怎样 为什么 关于 根据 通过 相关 希望 告诉 帮我 请问 文章 写作 写一篇 介绍'.split(' '));
export const RETRIEVAL_INFO = Object.freeze({
  engine: 'local-bm25-rrf-v1', name: '本地段落与写法检索',
  methods: ['BM25', '写作任务词扩展', 'RRF'], vectorSearch: false, modelCalls: 0,
});

function frequencies(value) {
  const source = String(value || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ');
  const result = new Map();
  const add = term => result.set(term, (result.get(term) || 0) + 1);
  for (const { segment, isWordLike } of segmenter.segment(source)) {
    if (isWordLike && segment.length > 1 && !stop.has(segment)) add('w:' + segment);
  }
  // Character pairs complement Chinese word segmentation for names/new words;
  // these are a low-weight lexical fallback, not semantic embeddings.
  for (const run of source.matchAll(/[\p{Script=Han}]+/gu)) {
    const chars = [...run[0]];
    for (let i = 0; i < chars.length - 1; i++) {
      const pair = chars[i] + chars[i + 1];
      if (!stop.has(pair)) add('c:' + pair);
    }
  }
  return result;
}

export function splitPassages(value, size = 900, overlap = 120) {
  const text = String(value || '').trim(), passages = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > start + size / 2) end = boundary;
    }
    const passage = text.slice(start, end).trim();
    if (passage) passages.push(passage);
    if (end === text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return passages;
}

export function createBm25Index(documents) {
  const postings = new Map(), lengths = [], docs = [...documents];
  let totalLength = 0;
  docs.forEach((doc, index) => {
    const terms = frequencies(doc.text), title = frequencies(doc.title);
    let length = 0;
    for (const count of terms.values()) length += count;
    for (const [term, count] of title) { length += count; terms.set(term, (terms.get(term) || 0) + 2 * count); }
    lengths.push(length); totalLength += length;
    for (const [term, count] of terms) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(index, count);
    }
  });
  // Document indices and term counts are integers. Compact postings rather than
  // keeping millions of boxed JS-array entries for the real full-text corpus.
  for (const [term, entries] of postings) postings.set(term, Uint32Array.from(entries));
  const averageLength = totalLength / (docs.length || 1) || 1;
  const idf = list => Math.log(1 + (docs.length - list.length / 2 + .5) / (list.length / 2 + .5));
  function search(query, { filter = () => true, limit = 80 } = {}) {
    const weights = new Map();
    for (const part of Array.isArray(query) ? query : [{ text: query, weight: 1 }]) {
      for (const term of frequencies(String(part.text || '').slice(0, 32_000)).keys()) {
        if (!postings.has(term)) continue;
        const weight = (part.weight || 1) * (term.startsWith('c:') ? .22 : 1);
        weights.set(term, Math.max(weights.get(term) || 0, weight));
      }
    }
    // Keep informative terms across the whole bounded input, rather than the
    // old first-64-character-pairs truncation. Query repetition adds no weight.
    const selected = [...weights].sort((a, b) => idf(postings.get(b[0])) * b[1] - idf(postings.get(a[0])) * a[1]).slice(0, 160);
    const scores = new Map(), k1 = 1.2, b = .75;
    for (const [term, weight] of selected) {
      const list = postings.get(term), importance = idf(list) * weight;
      for (let i = 0; i < list.length; i += 2) {
        const index = list[i], tf = list[i + 1];
        if (!filter(docs[index])) continue;
        const value = importance * tf * (k1 + 1) / (tf + k1 * (1 - b + b * lengths[index] / averageLength));
        scores.set(index, (scores.get(index) || 0) + value);
      }
    }
    // A long article may have many matching passages. Collapse it to its best
    // passage before taking the candidate window or fusing different channels.
    const parents = new Map();
    for (const [index, score] of scores) {
      const doc = docs[index], prior = parents.get(doc.key);
      if (!prior || score > prior.score) parents.set(doc.key, { ...doc, score });
    }
    return [...parents.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, limit).map(doc => {
      const terms = frequencies(doc.title + '\n' + doc.text);
      const matches = selected.filter(([term]) => terms.has(term));
      matches.sort((a, b) => Number(a[0].startsWith('c:')) - Number(b[0].startsWith('c:')) || idf(postings.get(b[0])) - idf(postings.get(a[0])));
      return { ...doc, matchedTerms: [...new Set(matches.map(([term]) => term.slice(2)))].slice(0, 8) };
    });
  }
  return { search, passageCount: docs.length };
}

const TASKS = [
  ['对比选型', /对比|比较|区别|差异|谁更|选型|怎么选|如何选|哪个好|取舍/, '对比 比较 差异 选型 适用人群 优缺点'],
  ['实测验证', /实测|亲测|测试|体验|跑分|好用|能不能|能否/, '实测 测试 体验 验证 任务 结果 局限'],
  ['操作教学', /怎么做|如何做|操作|教程|上手|部署|配置|步骤|复现/, '教程 操作 步骤 复现 准备 验收 排错'],
  ['原理解释', /是什么|原理|为什么|怎么回事|如何工作|意味着/, '解释 原理 概念 背景 变化 影响'],
  ['判断影响', /影响|判断|趋势|争议|值得|边界|风险|利弊|会不会/, '判断 影响 趋势 争议 证据 边界'],
  ['清单盘点', /盘点|清单|合集|有哪些|汇总|推荐/, '盘点 清单 分类 场景 筛选'],
  ['经历复盘', /经历|故事|转折|复盘|人物/, '经历 故事 选择 转折 结果 复盘'],
];

export function retrievalQuery({ brief = '', references = [] } = {}) {
  const selected = references.filter(r => r && (r.title || r.content)).slice(0, 100);
  const perReference = Math.min(3000, Math.floor(12_000 / (selected.length || 1)));
  const topicBrief = String(brief).slice(0, 20_000)
    .replace(/(?:围绕|根据|针对)?(?:这条|该条|本条|这则|这些|这份)(?:消息|资讯|新闻|材料|资料)/g, ' ')
    .replace(/(?:组织|撰写|生成|写)(?:一篇|这篇)(?:文章|稿件|稿子)/g, ' ');
  const topic = [{ text: topicBrief, weight: 2 }, ...selected.map(r => ({ text: String(r.title || '').slice(0, 500) + '\n' + String(r.content || '').slice(0, perReference), weight: 1 }))];
  // Explicit wording in the author's brief alone activates an intent. A pasted
  // article mentioning a test does not imply that the author ran that test.
  const tasks = TASKS.filter(([, trigger]) => trigger.test(brief));
  const pattern = tasks.length ? [{ text: topicBrief, weight: 1 }, { text: tasks.map(([, , terms]) => terms).join(' '), weight: .6 }] : [];
  return { topic, pattern, taskLabels: tasks.map(([label]) => label) };
}

export function reciprocalRankFusion(lists, constant = 60) {
  const merged = new Map();
  lists.forEach((list, channel) => {
    const seen = new Set();
    for (const hit of list) {
      if (seen.has(hit.key)) continue;
      seen.add(hit.key);
      const entry = merged.get(hit.key) || { key: hit.key, item: hit.item, score: 0, hits: [] };
      entry.score += 1 / (constant + seen.size);
      entry.hits.push({ ...hit, channel });
      merged.set(hit.key, entry);
    }
  });
  return [...merged.values()].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

const templateText = t => [t.fit, ...(t.sequence || []), t.materials, t.boundary, t.hooks].filter(Boolean).join('\n');
const patternText = a => [a.structureFit, a.recipe?.readerTask, a.recipe?.fitTopics, ...(a.stages || []), a.opening?.note, a.middle?.advance, a.ending?.note].filter(Boolean).join('\n');

export function createLibraryRetriever(library) {
  const documents = [], patterns = [];
  const add = (item, kind, text, notePath, obsidianUrl, category = 'article') => {
    for (const passage of splitPassages(text)) documents.push({ key: category + ':' + item.id, item, title: item.title || item.name, text: passage, kind, notePath, obsidianUrl, category });
  };
  for (const article of library.articles) {
    if (article._sourceText && article._sourceText !== article._analysisText) add(article, '原文', article._sourceText, article.originalNotePath || article.notePath, article.originalObsidianUrl || article.obsidianUrl);
    if (article._analysisText) add(article, '全文拆解', article._analysisText, article.notePath, article.obsidianUrl);
    // Only full analyses can support a reusable writing-pattern match. Old
    // candidate structure tags are excluded from this channel.
    const text = article.evidenceLevel === 'analyzed' ? patternText(article) : '';
    if (text) patterns.push({ key: 'article:' + article.id, item: article, title: '', text, kind: '拆解写法', notePath: article.notePath, obsidianUrl: article.obsidianUrl, category: 'article' });
  }
  for (const template of library.templates) {
    const text = templateText(template);
    add(template, '写作结构', text, template.notePath, template.obsidianUrl, 'template');
    // Negative boundaries/material gaps remain available to the writer and to
    // ordinary note search, but are not positive evidence of a structural fit.
    const fitText = [template.fit, ...(template.sequence || []), template.hooks].filter(Boolean).join('\n');
    patterns.push({ key: 'template:' + template.id, item: template, title: template.name, text: fitText, kind: '写作结构', notePath: template.notePath, obsidianUrl: template.obsidianUrl, category: 'template' });
  }
  for (const note of library.notes || []) add(note, '笔记', note._text, note.notePath, note.obsidianUrl, 'note');
  const corpus = createBm25Index(documents), writing = createBm25Index(patterns);
  const eligible = (doc, genre) => !genre || doc.category === 'note' || doc.item.genre === genre;
  function retrieve(input = {}, limit = 12) {
    const query = retrievalQuery(input);
    const articleFilter = doc => doc.category === 'article' && !String(doc.item.structureId || '').startsWith('X') && eligible(doc, input.genre);
    const topic = corpus.search(query.topic, { filter: articleFilter });
    const pattern = writing.search(query.pattern, { filter: articleFilter });
    const quality = entry => entry.item.reviewStatus === '独立复核通过' ? 2 : entry.item.evidenceLevel === 'analyzed' ? 1 : 0;
    const preference = entry => entry.item.evidenceLevel === 'analyzed' && entry.item.structureId === input.preferredStructure ? 1 : 0;
    const ranked = reciprocalRankFusion([topic, pattern]).sort((a, b) => b.score - a.score || quality(b) - quality(a) || preference(b) - preference(a) || a.key.localeCompare(b.key));
    const count = Math.max(0, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 12, 30));
    const selected = [], ids = new Set(), perStructure = new Map(), quota = Math.max(1, Math.ceil(count / 3));
    // Diversify only among retrieved matches; never fill gaps with zero matches.
    for (const entry of ranked) {
      if (selected.length === count) break;
      const code = entry.item.structureId;
      if ((perStructure.get(code) || 0) >= quota) continue;
      selected.push(entry); ids.add(entry.key); perStructure.set(code, (perStructure.get(code) || 0) + 1);
    }
    for (const entry of ranked) {
      if (selected.length === count) break;
      if (!ids.has(entry.key)) { selected.push(entry); ids.add(entry.key); }
    }
    const structureHits = writing.search(query.pattern, { filter: doc => doc.category === 'template' && eligible(doc, input.genre), limit: 30 });
    return { selected, structureHits, guidance: corpus.search(query.topic, { filter: doc => doc.category === 'note', limit: 3 }),
      retrieval: { ...RETRIEVAL_INFO, taskLabels: query.taskLabels, topicMatches: topic.length, patternMatches: pattern.length, candidateArticles: ranked.length, returnedExamples: selected.length, passages: corpus.passageCount,
        notice: selected.length ? '命中依据是词面与任务词匹配；排序分数不是准确率。' : '没有检索到相关案例；可以参考结构定义，但不能把案例缺口当成已有证据。' } };
  }
  function search({ q = '', genre = '', limit = 5 } = {}) {
    const count = Math.max(1, Math.min(Number(limit) || 5, 30));
    const matches = corpus.search(q, { filter: doc => eligible(doc, genre), limit: Number.MAX_SAFE_INTEGER });
    return { hits: matches.slice(0, count), total: matches.length, retrieval: { ...RETRIEVAL_INFO, passages: corpus.passageCount } };
  }
  return { retrieve, search };
}

export function explainMatch(entry) {
  const topic = entry.hits.find(hit => hit.channel === 0), pattern = entry.hits.find(hit => hit.channel === 1);
  const terms = [...new Set(entry.hits.flatMap(hit => hit.matchedTerms))].slice(0, 8);
  const channels = [topic && '主题文本', pattern && '拆解写法'].filter(Boolean);
  const best = topic || pattern;
  const reason = channels.join('、') + '命中：' + terms.join('、') + (topic ? '' : '。仅匹配写法，主题可能不同');
  return { channels, terms, reason, kind: best.kind, notePath: best.notePath, obsidianUrl: best.obsidianUrl, snippet: best.text.slice(0, 600) };
}
