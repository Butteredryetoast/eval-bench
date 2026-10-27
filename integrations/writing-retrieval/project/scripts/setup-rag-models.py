"""Download only the pinned public ONNX files; verify HF blob/LFS hashes.

No knowledge documents or API keys are sent to the model host.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request
import time

ROOT = Path(__file__).resolve().parents[1]
MODELS = json.loads((ROOT / 'server/rag/models.json').read_text())
CACHE = Path(os.environ.get('RAG_CACHE_DIR', ROOT / '.rag-cache')) / 'models'


def ranged_download(url, target, total):
    """Resume interrupted CDN responses, verify ranges, then assemble locally."""
    partial = target.with_name(target.name + '.partial')
    prefix = target.with_name(target.name + '.prefix')
    if not prefix.exists() and partial.exists() and partial.stat().st_size < total:
        partial.replace(prefix)
    offset = prefix.stat().st_size if prefix.exists() else 0
    chunk_size = 4 * 1024 * 1024
    ranges = [(start, min(start + chunk_size, total)) for start in range(offset, total, chunk_size)]

    def chunk(bounds):
        start, end = bounds
        path = target.with_name(target.name + '.part.' + str(start))
        for attempt in range(12):
            received = path.stat().st_size if path.exists() else 0
            if received == end - start:
                return path
            if received > end - start:
                path.unlink(); received = 0
            begin = start + received
            try:
                request = urllib.request.Request(url, headers={'Range': 'bytes=' + str(begin) + '-' + str(end - 1)})
                with urllib.request.urlopen(request, timeout=90) as response:
                    expected = 'bytes ' + str(begin) + '-' + str(end - 1) + '/' + str(total)
                    if response.status != 206 or response.headers.get('Content-Range') != expected:
                        raise RuntimeError('CDN returned an incorrect byte range')
                    with path.open('ab') as handle:
                        remaining = end - begin
                        while remaining:
                            data = response.read(min(256 * 1024, remaining))
                            if not data: break
                            handle.write(data); remaining -= len(data)
            except Exception:
                if attempt == 11: raise
                time.sleep(min(attempt + 1, 5))
        raise RuntimeError('Incomplete model byte range')

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        parts = list(pool.map(chunk, ranges))
    with partial.open('wb') as output:
        for path in ([prefix] if prefix.exists() else []) + parts:
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    output.write(block)
    return partial, ([prefix] if prefix.exists() else []) + parts


def download_model(role, spec):
    dest = CACHE / role
    dest.mkdir(parents=True, exist_ok=True, mode=0o700)
    with urllib.request.urlopen('https://huggingface.co/api/models/' + spec['repo'] + '/revision/' + spec['revision'] + '?blobs=true', timeout=60) as response:
        metadata = json.load(response)
    if metadata['sha'] != spec['revision']:
        raise RuntimeError('Model revision mismatch')
    files = {entry['rfilename']: entry for entry in metadata['siblings']}
    verified = []
    for filename in spec['files']:
        entry = files[filename]
        target = dest / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        expected_size = entry.get('lfs', {}).get('size', entry.get('size'))
        expected_hash = entry.get('lfs', {}).get('sha256')
        def valid(path):
            if not path.is_file() or (expected_size is not None and path.stat().st_size != expected_size):
                return False
            if expected_hash:
                digest = hashlib.sha256()
                with path.open('rb') as handle:
                    for block in iter(lambda: handle.read(1024 * 1024), b''):
                        digest.update(block)
                return digest.hexdigest() == expected_hash
            blob = path.read_bytes()
            return hashlib.sha1(b'blob ' + str(len(blob)).encode() + b'\0' + blob).hexdigest() == entry['blobId']
        if not valid(target):
            url = 'https://huggingface.co/' + spec['repo'] + '/resolve/' + spec['revision'] + '/' + urllib.parse.quote(filename, safe='/')
            partial = target.with_name(target.name + '.partial')
            cleanup = []
            print(json.dumps({'role': role, 'file': filename, 'phase': 'download', 'bytes': expected_size}), flush=True)
            if expected_size and expected_size > 4 * 1024 * 1024:
                partial, cleanup = ranged_download(url, target, expected_size)
            else:
                with urllib.request.urlopen(url, timeout=180) as response, partial.open('wb') as handle:
                    while True:
                        block = response.read(1024 * 1024)
                        if not block: break
                        handle.write(block)
            if not valid(partial):
                raise RuntimeError('Downloaded model hash mismatch: ' + filename)
            partial.replace(target)
            for path in cleanup: path.unlink(missing_ok=True)
        verified.append({'file': filename, 'bytes': target.stat().st_size, 'sha256': expected_hash})
    (dest / 'verified.json').write_text(json.dumps({'name': spec['name'], 'revision': spec['revision'], 'files': verified}, indent=2) + '\n')
    print(json.dumps({'role': role, 'phase': 'verified', 'files': len(verified)}), flush=True)


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda pair: download_model(*pair), MODELS.items()))
