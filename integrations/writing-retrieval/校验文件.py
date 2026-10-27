from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'MANIFEST.json').read_text(encoding='utf-8'))
errors = []
for item in manifest['files']:
    path = root / item['path']
    if not path.is_file():
        errors.append(item['path'] + ': missing')
        continue
    data = path.read_bytes()
    if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
        errors.append(item['path'] + ': checksum mismatch')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print('文件校验通过：', len(manifest['files']))
