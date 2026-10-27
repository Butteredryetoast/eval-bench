"""Private JSON-lines child process: Haystack retrieval + local FastEmbed.

No listening socket, remote LLM requests, telemetry, or access to Vault files.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import resource

os.environ.setdefault('HAYSTACK_TELEMETRY_ENABLED', 'false')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('TOKENIZERS_PARALLELISM', 'false')
os.environ.setdefault('OMP_NUM_THREADS', os.environ.get('RAG_THREADS', '2'))

from haystack import Document, Pipeline, component
from haystack.components.joiners import DocumentJoiner
from haystack_integrations.components.embedders.fastembed import FastembedTextEmbedder, FastembedDocumentEmbedder
from haystack_integrations.components.rankers.fastembed import FastembedRanker
from store import PassageStore, words

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get('RAG_CACHE_DIR', ROOT / '.rag-cache')).resolve()
MODELS_DIR = Path(os.environ.get('RAG_MODELS_DIR', CACHE / 'models')).resolve()
SPECS = json.loads((Path(__file__).parent / 'models.json').read_text())
IDENTITY = hashlib.sha256(json.dumps(SPECS, sort_keys=True).encode()).hexdigest()
THREADS = max(1, min(int(os.environ.get('RAG_THREADS', '2')), 4))
RANK_LIMIT = max(4, min(int(os.environ.get('RAG_RANK_CANDIDATES', '20')), 40))


class Models:
    def __init__(self):
        for role, spec in SPECS.items():
            verified = MODELS_DIR / role / 'verified.json'
            if not verified.is_file() or json.loads(verified.read_text()).get('revision') != spec['revision']:
                raise RuntimeError('Pinned model files are not ready; run setup-rag-models.py')
        common = dict(model=SPECS['embedding']['name'], cache_dir=str(MODELS_DIR), threads=THREADS,
                      local_files_only=True, progress_bar=False,
                      model_kwargs={'specific_model_path': str(MODELS_DIR / 'embedding'), 'providers': ['CPUExecutionProvider']})
        self.document_embedder = FastembedDocumentEmbedder(**common, batch_size=8)
        self.query_embedder = FastembedTextEmbedder(**common, prefix='为这个句子生成表示以用于检索相关文章：')
        self.reranker = FastembedRanker(
            model_name=SPECS['reranker']['name'], top_k=RANK_LIMIT, batch_size=1,
            cache_dir=str(MODELS_DIR), threads=THREADS, local_files_only=True,
            meta_fields_to_embed=['title', 'heading'],
            model_kwargs={'specific_model_path': str(MODELS_DIR / 'reranker'), 'providers': ['CPUExecutionProvider']})

    def embed_documents(self, texts):
        self.document_embedder.warm_up()
        for start in range(0, len(texts), 8):
            output = self.document_embedder.run([Document(content=text) for text in texts[start:start + 8]])
            yield from (doc.embedding for doc in output['documents'])

    def embed_query(self, query):
        self.query_embedder.warm_up()
        return self.query_embedder.run(query[:1800])['embedding']


@component
class LexicalRetriever:
    def __init__(self, store):
        self.store = store
        self.last_ids = set()

    @component.output_types(documents=list[Document])
    def run(self, query: str, genre: str, kinds: list[str]):
        docs = self.store.lexical(query, genre, kinds, limit=60)
        self.last_ids = {doc.id for doc in docs}
        return {'documents': docs}


@component
class QueryEmbedder:
    def __init__(self, models):
        self.models = models

    @component.output_types(embedding=list[float])
    def run(self, query: str):
        return {'embedding': self.models.embed_query(query)}


@component
class VectorRetriever:
    def __init__(self, store):
        self.store = store
        self.last_ids = set()

    @component.output_types(documents=list[Document])
    def run(self, embedding: list[float], genre: str, kinds: list[str]):
        docs = self.store.semantic(embedding, genre, kinds, limit=60)
        self.last_ids = {doc.id for doc in docs}
        return {'documents': docs}


@component
class ParentCandidates:
    def __init__(self, store):
        self.store = store

    @component.output_types(documents=list[Document])
    def run(self, documents: list[Document]):
        chosen, seen = [], set()
        for doc in documents:
            parent = doc.meta['parentKey']
            if parent in seen:
                continue
            # A reusable structure card is short enough to judge as a whole.
            # Avoid ranking a template by a single incidental boundary clause.
            if doc.meta['kind'] in ('template', 'blueprint'):
                from dataclasses import replace
                rows = self.store.db.execute('SELECT heading,content FROM chunks WHERE source_key=? ORDER BY position', (doc.meta['key'],)).fetchall()
                doc = replace(doc, content='\n'.join(heading+'\n'+content for heading, content in rows)[:1800])
            chosen.append(doc); seen.add(parent)
            if len(chosen) >= RANK_LIMIT:
                break
        return {'documents': chosen}


class RetrievalService:
    def __init__(self):
        self.models = Models()
        self.store = PassageStore(CACHE / ('index-' + IDENTITY[:12] + '.sqlite'), IDENTITY)
        self.lexical = LexicalRetriever(self.store)
        self.vector = VectorRetriever(self.store)
        self.pipeline = Pipeline()
        self.pipeline.add_component('query_embedding', QueryEmbedder(self.models))
        self.pipeline.add_component('lexical', self.lexical)
        self.pipeline.add_component('vector', self.vector)
        self.pipeline.add_component('fusion', DocumentJoiner(join_mode='reciprocal_rank_fusion', top_k=100))
        self.pipeline.add_component('parents', ParentCandidates(self.store))
        self.pipeline.add_component('ranker', self.models.reranker)
        self.pipeline.connect('query_embedding.embedding', 'vector.embedding')
        self.pipeline.connect('lexical.documents', 'fusion.documents')
        self.pipeline.connect('vector.documents', 'fusion.documents')
        self.pipeline.connect('fusion.documents', 'parents.documents')
        self.pipeline.connect('parents.documents', 'ranker.documents')

    def status(self):
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == 'darwin' else 1024)
        return {**self.store.status(), 'engine': 'haystack-fastembed-v1', 'embeddingModel': SPECS['embedding']['name'],
                'rerankerModel': SPECS['reranker']['name'], 'embeddingLoaded': self.models.document_embedder.embedding_backend is not None or self.models.query_embedder.embedding_backend is not None,
                'rerankerLoaded': self.models.reranker._model is not None, 'vectorSearch': True, 'remoteModelCalls': 0,
                'peakRssMiB': round(peak), 'threads': THREADS, 'rankCandidates': RANK_LIMIT}

    def query(self, query, genre='', kinds=None, limit=12, minimum_score=0, semantic_query=''):
        if not query.strip():
            return {'hits': [], 'meta': self.status()}
        kinds = kinds or ['source', 'analysis', 'template', 'note', 'blueprint']
        if any(kind not in ['source', 'analysis', 'template', 'note', 'blueprint'] for kind in kinds):
            raise ValueError('Invalid document kinds')
        started = time.monotonic()
        model_query = semantic_query or query[:440]
        self.models.reranker.warm_up()
        # The upstream M3 tokenizer permits 8192 tokens. Bound local CPU work;
        # this is the pinned 512-token budget recorded in models.json.
        self.models.reranker._model.model.tokenizer.enable_truncation(max_length=SPECS['reranker']['maxTokens'])
        output = self.pipeline.run({
            'query_embedding': {'query': model_query},
            'lexical': {'query': query, 'genre': genre, 'kinds': kinds},
            'vector': {'genre': genre, 'kinds': kinds},
            'ranker': {'query': model_query},
        })
        hits = []
        for doc in output['ranker']['documents']:
            if doc.score < minimum_score:
                continue
            channels = []
            if doc.id in self.lexical.last_ids: channels.append('lexical')
            if doc.id in self.vector.last_ids: channels.append('vector')
            hits.append({'parentKey': doc.meta['parentKey'], 'parentId': doc.meta['parentId'],
                         'score': doc.score, 'reranked': True, 'channels': channels,
                         'terms': [word for word in dict.fromkeys(words(query)) if word in doc.content.lower()][:8],
                         'passages': self.store.hydrate(doc, query)})
            if len(hits) >= limit:
                break
        return {'hits': hits, 'meta': {**self.status(), 'rerankApplied': True,
                                      'queryMs': round((time.monotonic() - started) * 1000),
                                      'lexicalCandidates': len(self.lexical.last_ids), 'vectorCandidates': len(self.vector.last_ids)}}

    def dispatch(self, method, params):
        if method == 'health': return self.status()
        if method == 'plan':
            current = self.store.catalog()
            return {'changed': [item['key'] for item in params['manifest'] if current.get(item['key']) != item['digest']], **self.status()}
        if method == 'upsert': return self.store.upsert(params['source'], self.models)
        if method == 'commit': return {**self.store.commit(params['manifest'], params['revision']), **self.status()}
        if method == 'query':
            if params.pop('revision', '') != self.store.setting('revision'):
                raise ValueError('Requested library revision is not indexed')
            return self.query(**params)
        raise ValueError('Unsupported operation')


if __name__ == '__main__':
    service = None
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 16 * 1024 * 1024:
                raise ValueError('Request too large')
            request = json.loads(line)
            if service is None:
                service = RetrievalService()
            result = service.dispatch(request['method'], request.get('params', {}))
            response = {'id': request['id'], 'result': result}
        except Exception as error:
            print(type(error).__name__ + ': ' + str(error), file=sys.stderr, flush=True)
            response = {'id': request.get('id') if isinstance(request, dict) else None,
                        'error': {'code': 'RAG_UNAVAILABLE', 'message': '本地 RAG 检索暂不可用，请检查模型和索引状态。'}}
        print(json.dumps(response, ensure_ascii=False), flush=True)
