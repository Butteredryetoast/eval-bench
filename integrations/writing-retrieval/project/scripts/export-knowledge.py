#!/usr/bin/env python3
"""Export a compact, read-only writing knowledge library from source analyses."""
import argparse
import json
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / 'outputs'


def read_json(path):
    with path.open(encoding='utf-8') as stream:
        return json.load(stream)


def export(source_root: Path, output: Path):
    template_source = read_json(source_root / '分类数据' / '结构模板.json')
    article_path = source_root / '结构定向补强第三轮' / '文章全文拆解.jsonl'
    stats_path = source_root / '结构定向补强第三轮' / '交付统计.json'
    review_path = source_root / '结构定向补强第三轮' / 'review_application.json'

    templates = []
    for code, record in template_source.items():
        if code.startswith('X'):
            continue
        templates.append({
            'id': record.get('id', code), 'genre': record.get('genre'), 'name': record.get('name'),
            'fit': record.get('fit'), 'sequence': record.get('sequence', []),
            'materials': record.get('materials'), 'boundary': record.get('boundary'),
            'hooks': record.get('hooks'),
        })

    reviews = read_json(review_path)
    independent_ids = {item['article_id'] for item in reviews.get('applied', []) if item.get('article_id')}
    delivery_stats = read_json(stats_path)
    def flatten(items):
        for item in items or []:
            if isinstance(item, dict):
                yield item
            elif isinstance(item, list):
                yield from flatten(item)

    articles = []
    with article_path.open(encoding='utf-8') as stream:
        for line in stream:
            if not line.strip():
                continue
            raw = json.loads(line)
            snapshot = raw.get('source_snapshot') or {}
            structure = raw.get('structure') or {}
            recipe = raw.get('reusable_recipe') or {}
            qa = raw.get('qa') or {}
            title = snapshot.get('title') or ''
            # Preserve the complete snapshot title and use only its first line for UI display.
            display_title = title.splitlines()[0].strip() if title.splitlines() else ''
            articles.append({
                'id': raw.get('article_id'), 'title': display_title, 'sourceTitle': title,
                'account': snapshot.get('account'), 'url': snapshot.get('url'),
                'publishDate': snapshot.get('publish_date'), 'genre': (raw.get('genre') or {}).get('primary'),
                'structureId': structure.get('primary_code'), 'structureName': structure.get('primary_name'),
                'structureFit': structure.get('fit_reason'), 'sourceIntegrity': raw.get('source_integrity'),
                'analysisStatus': raw.get('analysis_status'), 'reviewStatus': (
                    '独立复核通过' if raw.get('article_id') in independent_ids else
                    '独立钩子核对' if (qa.get('targeted_hook_review') or {}).get('status') == 'passed' else
                    'AI自检通过' if qa.get('status') in ('self_check_passed', 'passed') else
                    qa.get('status') or '未注明'
                ),
                'qa': {'status': qa.get('status'), 'reviewer': qa.get('reviewer'), 'method': qa.get('method')},
                'recipe': {
                    'readerTask': recipe.get('reader_task'), 'fitTopics': recipe.get('fit_topics'),
                    'requiredMaterials': recipe.get('required_materials'),
                    'cannotUseWithout': recipe.get('cannot_use_without'), 'boundary': recipe.get('boundary'),
                },
                'stages': [item.get('stage') for item in raw.get('observed_stages', []) if item.get('stage')],
                'stageNotes': [{'stage': item.get('stage'), 'note': item.get('note')} for item in raw.get('observed_stages', []) if item.get('stage')],
                'opening': {'function': (raw.get('opening') or {}).get('function'), 'hooks': (raw.get('opening') or {}).get('hooks'), 'note': (raw.get('opening') or {}).get('note')},
                'middle': {'functions': (raw.get('middle') or {}).get('functions'), 'advance': (raw.get('middle') or {}).get('advance')},
                'ending': {'functions': (raw.get('ending') or {}).get('functions'), 'note': (raw.get('ending') or {}).get('note')},
                'hookChains': [{'promise': item.get('promise'), 'status': item.get('status')} for item in flatten(raw.get('hook_chains', []))],
                # Interaction metrics and full article bodies intentionally stay out of this package.
            })

    output.parent.mkdir(parents=True, exist_ok=True)
    package = {
        'schemaVersion': 1,
        'templates': templates,
        'articles': articles,
        'stats': {'articles': len(articles), 'templates': len(templates), 'independentReviews': delivery_stats.get('qa', {}).get('AI独立复核通过', len(independent_ids))},
    }
    output.write_text(json.dumps(package, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(package['stats'], ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'knowledge' / 'library.json')
    args = parser.parse_args()
    export(args.source_root, args.output)


if __name__ == '__main__':
    main()
