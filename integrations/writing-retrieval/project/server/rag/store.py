"""Owned, disk-backed passage/FTS/vector cache. Never opens or writes the Vault."""
import hashlib
import json
import logging
import re
import sqlite3
from pathlib import Path

import jieba
import numpy as np
import sqlite_vec

jieba.setLogLevel(logging.ERROR)
STOP = set('一个 一种 一些 这个 那个 这些 那些 我们 你们 他们 自己 可以 需要 进行 以及 因为 所以 但是 如果 已经 现在 如何 什么 怎样 为什么 关于 根据 通过 相关 希望 告诉 帮我 请问 文章 写作 写一篇 介绍'.split())


def words(text):
    return [word.lower() for word in jieba.cut(str(text).lower(), HMM=False)
            if len(word.strip()) > 1 and word not in STOP and re.search(r'[\w\u3400-\u9fff]', word)]


class PassageStore:
    def __init__(self, path, identity, dimensions=512):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.path)
        self.db.enable_load_extension(True)
        sqlite_vec.load(self.db)
        self.db.enable_load_extension(False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA cache_size=-16384')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sources (key TEXT PRIMARY KEY, digest TEXT NOT NULL, metadata TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS chunks (
              rowid INTEGER PRIMARY KEY, chunk_id TEXT UNIQUE NOT NULL, source_key TEXT NOT NULL,
              parent_key TEXT NOT NULL, kind TEXT NOT NULL, genre TEXT NOT NULL, position INTEGER NOT NULL,
              heading TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source_key);
            CREATE INDEX IF NOT EXISTS chunks_parent ON chunks(parent_key, kind, position);
            CREATE VIRTUAL TABLE IF NOT EXISTS lexical USING fts5(title, body, tokenize='unicode61');
            CREATE TABLE IF NOT EXISTS embedding_cache (hash TEXT PRIMARY KEY, vector BLOB NOT NULL);
        ''')
        self.db.execute(f'''CREATE VIRTUAL TABLE IF NOT EXISTS vectors USING vec0(
            embedding float[{int(dimensions)}] distance_metric=cosine,
            genre text partition key, kind text partition key)''')
        previous = self.setting('identity')
        if previous and previous != identity:
            raise ValueError('Index identity mismatch; use a new cache file')
        self.identity = identity
        self.dimensions = dimensions
        self.set_setting('identity', identity)
        self.db.commit()

    def setting(self, key):
        row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return row[0] if row else ''

    def set_setting(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))

    def catalog(self):
        return dict(self.db.execute('SELECT key,digest FROM sources'))

    def status(self):
        return {
            'revision': self.setting('revision'),
            'sources': self.db.execute('SELECT count(*) FROM sources').fetchone()[0],
            'passages': self.db.execute('SELECT count(*) FROM chunks').fetchone()[0],
            'articles': self.db.execute("SELECT count(DISTINCT parent_key) FROM chunks WHERE kind IN ('source','analysis')").fetchone()[0],
            'templates': self.db.execute("SELECT count(DISTINCT parent_key) FROM chunks WHERE kind='template'").fetchone()[0],
        }

    def _delete_source(self, key):
        for (rowid,) in self.db.execute('SELECT rowid FROM chunks WHERE source_key=?', (key,)).fetchall():
            self.db.execute('DELETE FROM lexical WHERE rowid=?', (rowid,))
            self.db.execute('DELETE FROM vectors WHERE rowid=?', (rowid,))
        self.db.execute('DELETE FROM chunks WHERE source_key=?', (key,))
        self.db.execute('DELETE FROM sources WHERE key=?', (key,))

    def upsert(self, source, models):
        key, digest = source['key'], source['digest']
        previous = self.db.execute('SELECT digest FROM sources WHERE key=?', (key,)).fetchone()
        if previous and previous[0] == digest:
            return {'changed': False, 'embedded': 0}
        chunks = source.get('chunks', [])
        if len(chunks) > 5000 or any(not isinstance(c.get('content'), str) or len(c['content']) > 1200 for c in chunks):
            raise ValueError('Invalid passage batch')
        texts = [(source['title'][:60] + '\n' + c.get('heading', '')[:60] + '\n' + c['content']).strip() for c in chunks]
        hashes = [hashlib.sha256((self.identity + '\n' + text).encode()).hexdigest() for text in texts]
        vectors, missing = {}, []
        for i, key_hash in enumerate(hashes):
            row = self.db.execute('SELECT vector FROM embedding_cache WHERE hash=?', (key_hash,)).fetchone()
            if row:
                vectors[i] = row[0]
            else:
                missing.append(i)
        if missing:
            for index, vector in zip(missing, models.embed_documents([texts[i] for i in missing]), strict=True):
                array = np.asarray(vector, dtype='<f4')
                if array.shape != (self.dimensions,) or not np.isfinite(array).all():
                    raise ValueError('Invalid embedding shape')
                vectors[index] = array.tobytes()
        metadata = {k: v for k, v in source.items() if k != 'chunks'}
        # Embedding/inference must finish before replacing the old source.
        # Any failure leaves the last committed source intact.
        with self.db:
            self.set_setting('revision', '')
            self._delete_source(key)
            self.db.execute('INSERT INTO sources VALUES (?,?,?)', (key, digest, json.dumps(metadata, ensure_ascii=False)))
            for i, chunk in enumerate(chunks):
                content = chunk['content']
                row = self.db.execute('''INSERT INTO chunks(chunk_id,source_key,parent_key,kind,genre,position,heading,content,metadata)
                    VALUES (?,?,?,?,?,?,?,?,?)''', (chunk['id'], key, source['parentKey'], source['kind'], source['genre'], chunk['index'], chunk.get('heading', ''), content, json.dumps(metadata, ensure_ascii=False)))
                rowid = row.lastrowid
                self.db.execute('INSERT INTO lexical(rowid,title,body) VALUES (?,?,?)', (rowid, ' '.join(words(source['title'])), ' '.join(words(chunk.get('heading', '') + '\n' + content))))
                self.db.execute('INSERT INTO vectors(rowid,embedding,genre,kind) VALUES (?,?,?,?)', (rowid, vectors[i], source['genre'], source['kind']))
                self.db.execute('INSERT OR IGNORE INTO embedding_cache VALUES (?,?)', (hashes[i], vectors[i]))
        return {'changed': True, 'embedded': len(missing), 'passages': len(chunks)}

    def commit(self, manifest, revision):
        desired = {item['key']: item['digest'] for item in manifest}
        if len(desired) != len(manifest):
            raise ValueError('Duplicate source keys')
        current = self.catalog()
        if any(current.get(key) != digest for key, digest in desired.items()):
            raise ValueError('Incomplete index; revision was not committed')
        with self.db:
            for key in current.keys() - desired.keys():
                self._delete_source(key)
            self.set_setting('revision', revision)
        return self.status()

    def _document(self, rowid, score, channel):
        from haystack import Document
        row = self.db.execute('SELECT chunk_id,content,heading,position,metadata FROM chunks WHERE rowid=?', (rowid,)).fetchone()
        if not row:
            return None
        meta = json.loads(row[4])
        meta.update({'heading': row[2], 'position': row[3], 'rowid': rowid, 'channels': [channel]})
        return Document(id=row[0], content=row[1], meta=meta, score=float(score))

    def lexical(self, query, genre, kinds, limit=40, parent_key=None):
        terms = list(dict.fromkeys(words(query)))[:80]
        if not terms:
            return []
        match = ' OR '.join('"' + term.replace('"', '""') + '"' for term in terms)
        where, args = ['lexical MATCH ?'], [match]
        if genre:
            where.append("(c.genre=? OR (c.kind='note' AND c.genre=''))" if 'note' in kinds else 'c.genre=?'); args.append(genre)
        if kinds:
            where.append('c.kind IN (' + ','.join('?' for _ in kinds) + ')'); args.extend(kinds)
        if parent_key:
            where.append('c.parent_key=?'); args.append(parent_key)
        if parent_key:
            # Constrain FTS by the small parent rowid set. A regular JOIN lets
            # SQLite scan/rank the entire corpus again for each hydrated hit.
            sql = '''SELECT rowid,bm25(lexical,3,1) AS relevance FROM lexical
                WHERE lexical MATCH ? AND rowid IN (SELECT c.rowid FROM chunks c WHERE ''' + ' AND '.join(where[1:]) + ') ORDER BY relevance LIMIT ?'
        else:
            # FTS5's rank column supports ordered top-k retrieval without the
            # temporary full-result sort required by ORDER BY bm25(...).
            # The per-query mapping preserves the exact title/body weights.
            where.insert(1, "rank MATCH 'bm25(3,1)'")
            sql = '''SELECT c.rowid,lexical.rank AS relevance FROM lexical
                JOIN chunks c ON c.rowid=lexical.rowid WHERE ''' + ' AND '.join(where) + ' ORDER BY lexical.rank LIMIT ?'
        rows = self.db.execute(sql, args + [limit]).fetchall()
        return [self._document(rowid, -score, 'lexical') for rowid, score in rows]

    def semantic(self, embedding, genre, kinds, limit=40):
        if genre and 'note' in kinds:
            # vec0 metadata filters do not support arbitrary SQL OR clauses.
            # Retrieve global method notes separately, keeping blank-genre
            # articles outside a requested genre, then merge by cosine distance.
            scoped = [kind for kind in kinds if kind != 'note']
            docs = self.semantic(embedding, genre, scoped, limit) if scoped else []
            docs += self.semantic(embedding, '', ['note'], limit)
            return sorted(docs, key=lambda doc: (-doc.score, doc.id))[:limit]
        vector = np.asarray(embedding, dtype='<f4').tobytes()
        where = ['embedding MATCH ?', 'k=?']
        args = [vector, limit]
        if genre:
            where.append('genre=?'); args.append(genre)
        if kinds:
            where.append('kind IN (' + ','.join('?' for _ in kinds) + ')'); args.extend(kinds)
        rows = self.db.execute('SELECT rowid,distance FROM vectors WHERE ' + ' AND '.join(where) + ' ORDER BY distance', args).fetchall()
        return [self._document(rowid, 1 - distance, 'vector') for rowid, distance in rows]

    def hydrate(self, document, query):
        meta = document.meta
        rows = self.db.execute('''SELECT rowid FROM chunks WHERE source_key=? AND position BETWEEN ? AND ?
            AND heading=? ORDER BY abs(position-?)''', (meta['key'], meta['position'] - 1, meta['position'] + 1, meta['heading'], meta['position'])).fetchall()
        docs = [document]
        for (rowid,) in rows:
            if rowid != meta['rowid']:
                docs.append(self._document(rowid, 0, 'context'))
        if meta['kind'] in ('source', 'analysis'):
            other = 'analysis' if meta['kind'] == 'source' else 'source'
            extra = self.lexical(query, meta['genre'], [other], 1, meta['parentKey'])
            docs.extend(extra)
        return [{
            'id': doc.id, 'sourceKey': doc.meta['key'], 'sourceDigest': doc.meta['digest'], 'kind': doc.meta['kind'],
            'heading': doc.meta.get('heading', ''), 'content': doc.content,
            'notePath': doc.meta['notePath'], 'obsidianUrl': doc.meta['obsidianUrl'],
        } for doc in docs[:4] if doc is not None]
