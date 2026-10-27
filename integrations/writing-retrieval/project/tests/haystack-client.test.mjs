import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHaystackClient} from '../server/haystack-client.mjs';
test('index lock blocks a second writer and stale locks can be recovered',async()=>{
 const cacheDir=await mkdtemp(join(tmpdir(),'rag-lock-')),a=createHaystackClient({cacheDir}),b=createHaystackClient({cacheDir});
 try{await a.acquireIndexLock();await assert.rejects(b.acquireIndexLock(),{code:'RAG_INDEXING'});await a.releaseIndexLock();await b.acquireIndexLock();await b.releaseIndexLock();await writeFile(join(cacheDir,'indexing.lock'),JSON.stringify({pid:2147483646}));await a.acquireIndexLock();await a.releaseIndexLock();}
 finally{a.close();b.close();await rm(cacheDir,{recursive:true,force:true});}
});
