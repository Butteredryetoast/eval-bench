"""Real SQLite/FTS/vector behavior; the embedding stub is only a unit fixture."""
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server/rag'))
from store import PassageStore


class EmbeddingFixture:
    fail = False
    count = 0

    def embed_documents(self, texts):
        if self.fail:
            raise RuntimeError('fixture inference failure')
        self.count += len(texts)
        yield from ([1.0, 0.0, 0.0] for _ in texts)


def source(key='source:A1', digest='v1', content='星际飞船续航记录', genre='测评'):
    return {'key': key, 'digest': digest, 'parentKey': 'article:' + key.split(':')[1], 'parentId': key.split(':')[1],
            'kind': 'source', 'category': 'article', 'title': '测试', 'genre': genre, 'structureId': 'R1',
            'notePath': '库/A1.md', 'obsidianUrl': 'obsidian://open?vault=test&file=A1', 'evidenceLevel': 'candidate',
            'chunks': [{'id': key + ':' + digest, 'index': 0, 'heading': '结果', 'content': content}]}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = PassageStore(Path(self.tmp.name) / 'index.sqlite', 'fixture', dimensions=3)
        self.models = EmbeddingFixture()

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def test_text_vector_filter_and_update_cache(self):
        a, b = source(), source('source:A2', genre='教程')
        self.store.upsert(a, self.models); self.store.upsert(b, self.models)
        self.store.commit([a, b], 'r1')
        self.assertEqual(len(self.store.lexical('星际飞船', '测评', ['source'])), 1)
        self.assertEqual(len(self.store.semantic([1, 0, 0], '测评', ['source'])), 1)
        self.assertEqual(self.store.semantic([1, 0, 0], '教程', ['source'])[0].meta['parentId'], 'A2')
        before = self.models.count
        self.assertFalse(self.store.upsert(a, self.models)['changed'])
        changed = source(digest='v2', content='咖啡烘焙记录')
        self.store.upsert(changed, self.models)
        self.assertEqual(self.store.setting('revision'), '')
        self.store.commit([changed], 'r2')
        self.assertGreater(self.models.count, before)
        self.assertEqual(self.store.lexical('星际飞船', '', ['source']), [])
        self.assertEqual(self.store.status()['articles'], 1)
        self.assertEqual(self.store.status()['revision'], 'r2')

    def test_inference_failure_cannot_delete_last_good_source(self):
        a = source(); self.store.upsert(a, self.models); self.store.commit([a], 'r1')
        self.models.fail = True
        with self.assertRaises(RuntimeError):
            self.store.upsert(source(digest='v2', content='新内容'), self.models)
        self.assertEqual(self.store.catalog()[a['key']], 'v1')
        self.assertEqual(self.store.setting('revision'), 'r1')

    def test_incomplete_catalog_cannot_claim_a_complete_revision(self):
        a, b = source(), source('source:A2')
        self.store.upsert(a, self.models)
        with self.assertRaises(ValueError):
            self.store.commit([a, b], 'not-complete')
        self.assertEqual(self.store.setting('revision'), '')

    def test_method_notes_without_genre_do_not_admit_unclassified_articles(self):
        unknown, selected = source('source:UNKNOWN', genre=''), source('source:SELECTED', genre='教程')
        note = source('note:METHOD', genre=''); note['kind'] = 'note'
        for item in [unknown, selected, note]: self.store.upsert(item, self.models)
        kinds = ['source', 'note']
        for results in [self.store.lexical('星际飞船', '教程', kinds), self.store.semantic([1, 0, 0], '教程', kinds)]:
            self.assertEqual({doc.meta['parentId'] for doc in results}, {'SELECTED', 'METHOD'})

    def test_parent_context_stays_scoped_and_preserves_weighted_bm25_order(self):
        a, b = source(), source('source:A2', content='星际飞船 星际飞船 续航 续航')
        self.store.upsert(a, self.models); self.store.upsert(b, self.models)
        docs = self.store.lexical('星际飞船 续航', '测评', ['source'])
        expected = self.store.db.execute("SELECT rowid,bm25(lexical,3,1) FROM lexical WHERE lexical MATCH ? ORDER BY bm25(lexical,3,1)", ('"星际" OR "飞船" OR "续航"',)).fetchall()
        self.assertEqual([d.meta['rowid'] for d in docs], [r[0] for r in expected])
        scoped = self.store.lexical('星际飞船 续航', '测评', ['source'], 1, 'article:A1')
        self.assertEqual([d.meta['parentId'] for d in scoped], ['A1'])


if __name__ == '__main__':
    unittest.main()
