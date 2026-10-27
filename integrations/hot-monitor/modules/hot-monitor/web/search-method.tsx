import {InfoDialog} from "./info-dialog.tsx";
export function SearchMethod(){return <div className="hm-search-method"><InfoDialog label="搜索关键词的方法" title="多个关键词怎么搜索？">
  <p className="hm-prose">先用具体主体，例如Claude、可灵，再补确切版本或任务，例如视频、编程。不要直接搜索整句新闻，也不要把所有同义名用空格堆在一起。</p>
  <dl className="hm-rule-definitions"><div><dt>空格分词</dt><dd>框内填短词组，例如「Claude Opus 5.5 编程」。普通平台会按自己的相关性规则检索，不保证所有词都严格同时命中；本站会分别适配平台。</dd></div><div><dt>AND：同时包含</dt><dd><code>Anthropic AND review</code>表示同时包含两个条件。Reddit明确使用AND，避免只搜到其中一个词。</dd></div><div><dt>OR：任意一个</dt><dd><code>(demo OR review OR 实测)</code>表示任选一个。括号把一组同义或用途词放在一起，不是需要逐个同时出现。</dd></div><div><dt>引号与日期</dt><dd>引号用于短语；X的<code>since:2026-10-24</code>表示从该日开始。YouTube与中文平台不套用X的日期写法。</dd></div></dl>
  <p className="hm-prose">图中的demo是演示，showcase是作品展示，example是案例，review是评测，experience是体验。默认不会补这些词；只有在优化搜索里主动选择用途才会添加。不必手写括号或OR。</p>
  <p className="hm-caption">默认直接搜索你选的词。结果少时减少词，或关闭优化搜索里的用途条件，再在平台内调整筛选。选字、改词、预览与复制不会调用本站付费接口；只有点击接口搜索才提交后台。</p>
  </InfoDialog><span>先选主体，再按需补版本或任务；默认只搜所选词，用途条件可选。</span></div>;}
