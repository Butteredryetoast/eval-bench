"""Read-only media order audit. Does not view media or verify reported facts."""
import hashlib
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = Path(os.environ.get('RAW_ARTICLE_SNAPSHOT', ROOT.parent / 'work/final_articles.json'))
VAULT = Path(os.environ.get('OBSIDIAN_VAULT_PATH', Path.home() / 'Documents/Obsidian Vault'))
LIBRARY = VAULT / os.environ.get('OBSIDIAN_LIBRARY_PATH', '公众号写作结构库')
CHECKS = {
    'A500405': [
        ('开头先展示效果再评价', '先给大家放几个效果', '▶点击观看微信视频', '非常出乎我意料'),
        ('测试输入与评价之间有输出媒体', '提示语：一位年轻女子向前慢跑几步', '![](', '慢跑 -> 停下'),
    ],
    'A400039': [
        ('复杂动作：先讲难点，展示视频，再评结果', '人物和道具要交互', '▶点击观看微信视频', 'Seedance 2.0 fast整体空间推进'),
        ('奇幻场景中途展示对照视频', '看一下依旧是同一套提示词下各大模型的表现', '▶点击观看微信视频', 'Fast 的表现其实挺让人惊喜'),
    ],
    'A600264': [
        ('模型选择操作后跟图，再继续下一步', '点击左下角【本地模型】', '![](', '甚至可以一键安装'),
        ('导入结果与下一操作之间跟图', '19个pdf文件大约1分半处理完毕', '![](', '创建智能体'),
        ('简短失败判断之后展示媒体，再作总体归纳', '试了一下，上传图片到知识库，发现目前图片解析还不太行', '![](', '它的知识库，我体验下来'),
    ],
    'A300587': [
        ('成品视频先出，再展开人物故事', '这个视频它是这样的', '▶点击观看微信视频', '视频的评论'),
        ('故事后段出现信件媒体，接翻译与情绪回扣', '2013年11月18日', '![](', '我用AI给这封信提取并翻译'),
        ('结尾歌曲媒体承担回扣', '最后，用2013年松尾', '▶点击观看微信视频', '银汉难通'),
    ],
}
rows = json.loads(SNAPSHOT.read_text())
records = []
for row in rows:
    if row.get('id') not in CHECKS:
        continue
    body = row['正文']
    path = next((LIBRARY / '文章').rglob(row['id'] + ' *.md'))
    vault = path.read_text().split('## 来源与正文转写')[-1]
    paragraphs = []
    for match in re.finditer(r'^### P(\d+)\s*\n([\s\S]*?)(?=^### P\d+\s*$|\Z)', vault, re.M):
        text = re.sub(r'\n\^p\d+\s*$', '', match[2])
        paragraphs.append(re.sub(r'^>\s?', '', text, flags=re.M).strip())
    normalize = lambda value: re.sub(r'\s+', '', value)
    same = len(paragraphs) == len(row['paragraphs']) and all(normalize(a) == normalize(b) for a, b in zip(paragraphs, row['paragraphs']))
    assert same, 'Snapshot/Vault paragraph mismatch: ' + row['id']
    checks = []
    for label, before, media, after in CHECKS[row['id']]:
        start = body.find(before)
        middle = body.find(media, start + len(before))
        end = body.find(after, start + len(before))
        assert 0 <= start < middle < end, (row['id'], label)
        checks.append({'label': label, 'verified': True, 'before': before, 'mediaMarker': media, 'after': after, 'offsets': [start, middle, end]})
    records.append({'id': row['id'], 'title': row['标题'], 'originalSnapshot': str(SNAPSHOT), 'sourceRow': row['source_row'], 'markdownSha256': hashlib.sha256(body.encode()).hexdigest(),
                    'markdownImageLinksIncludingCoversAndDecorations': len(re.findall(r'!\[', body)), 'videoLabels': body.count('▶点击观看微信视频'),
                    'vaultMarkdownImageLinks': len(re.findall(r'!\[', vault)), 'vaultParagraphs': len(paragraphs), 'snapshotParagraphs': len(row['paragraphs']),
                    'paragraphTextMatchesSnapshot': same, 'sequenceChecks': checks})
assert len(records) == len(CHECKS)
analyses = list((LIBRARY / '全文拆解v5/文章').glob('*.md'))
texts = [path.read_text() for path in analyses]
report = {'scope': 'Original Markdown snapshot versus current Vault; media node order only, no visual inspection or third-party fact verification.', 'records': records,
          'verifiedSequenceChecks': sum(len(record['sequenceChecks']) for record in records),
          'fifthSample': 'APae4085ada612: current Vault text/caption and evidence ordering inspected; original media snapshot not checked.',
          'phraseCountsNotQualityScores': {'analyses': len(texts), 'withGenericProgression': sum('推进关系：按原文顺序推进' in text for text in texts),
                                          'genericProgressionOccurrences': sum(text.count('推进关系：按原文顺序推进') for text in texts)}}
dest = ROOT / 'docs/qa/narrative-media-order.json'
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'verifiedArticles': len(records), 'verifiedMediaRelations': report['verifiedSequenceChecks'], 'phraseCountsNotQualityScores': report['phraseCountsNotQualityScores']}, ensure_ascii=False))
