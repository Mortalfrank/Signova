"""Create a standalone Node-only evaluation bundle; never includes .env."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
run = root / 'benchmarks' / 'results' / 'qwen-agent-v2'
summary = json.loads((run / 'summary.json').read_text(encoding='utf-8'))
if not summary.get('complete'):
    raise RuntimeError('Only a complete evaluation can be packaged.')
destination = root.parent / 'deliveries'
destination.mkdir(exist_ok=True)
archive = destination / 'signova-agent-benchmark-v2.zip'
files = set()
for directory in ['benchmarks', 'docs/benchmarks']:
    for path in (root / directory).rglob('*'):
        if path.is_file() and path.suffix not in {'.log', '.pyc'}:
            files.add(path.relative_to(root).as_posix())
for relative in ['model.mjs', 'public/core.js', 'public/model-context.js', 'public/memory-resolution.js',
                 'public/communication-analysis.js', 'public/streaming-policy.js', 'public/speech-replay.js',
                 'public/algorithm-evaluation.js', 'scripts/package-agent-benchmark.py',
                 '.github/workflows/agent-evaluation.yml']:
    if (root / relative).is_file():
        files.add(relative)
for path in (root / 'test').glob('benchmark-*.test.mjs'):
    files.add(path.relative_to(root).as_posix())
payloads = {relative: (root / relative).read_bytes() for relative in sorted(files)}
package = {'name': 'signova-agent-benchmark', 'version': '1.0.0', 'private': True, 'type': 'module', 'engines': {'node': '>=22'},
           'scripts': {'test': 'node --test test/benchmark-arms.test.mjs test/benchmark-dataset.test.mjs test/benchmark-dataset-v2.test.mjs test/benchmark-metrics.test.mjs test/benchmark-runner.test.mjs',
                       'bench:qwen': 'node --env-file-if-exists=.env benchmarks/run.mjs --dataset benchmarks/datasets/communication-v2.jsonl --out benchmarks/results/qwen-agent-v2 --arms qwen-direct,qwen-keyword,signova-agent --max-model-calls 180',
                       'bench:qwen:dry': 'node --env-file-if-exists=.env benchmarks/run.mjs --dataset benchmarks/datasets/communication-v2.jsonl --out benchmarks/results/qwen-agent-v2 --arms qwen-direct,qwen-keyword,signova-agent --max-model-calls 180 --dry-run',
                       'bench:qwen:report': 'node benchmarks/report.mjs --run benchmarks/results/qwen-agent-v2', 'bench:qwen:verify': 'node benchmarks/verify.mjs --run benchmarks/results/qwen-agent-v2'}}
payloads['package.json'] = (json.dumps(package, ensure_ascii=False, indent=2) + '\n').encode()
lock = {'name': package['name'], 'version': package['version'], 'lockfileVersion': 3, 'requires': True,
        'packages': {'': {'name': package['name'], 'version': package['version'], 'engines': package['engines']}}}
payloads['package-lock.json'] = (json.dumps(lock, ensure_ascii=False, indent=2) + '\n').encode()
payloads['.env.example'] = b'AI_API_KEY=\nAI_MODEL=qwen3.7-plus\nAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1\nAI_ENABLE_THINKING=false\n'
payloads['.gitignore'] = b'.env\n.env.*\n!.env.example\nnode_modules/\n*.log\n'
payloads['README.md'] = ('# SIGNOVA Agent Benchmark v2\n\nStandalone evaluation bundle. Node.js 22+, no npm dependencies.\n\n'
                         'Run `npm test`, `npm run bench:qwen:verify`, and `npm run bench:qwen:report` offline.\n'
                         'For new paid requests, copy `.env.example` to `.env`, configure your own key, and choose a new `--out` directory.\n\n'
                         'Chinese instructions: [benchmarks/README.md](benchmarks/README.md). '
                         'Measured results: [docs/benchmarks/qwen-agent-v2.md](docs/benchmarks/qwen-agent-v2.md).\n'
                         'The data and labels are AI-assisted synthetic fixtures, not an independently reviewed human gold set.\n').encode()
secrets = []
if (root / '.env').is_file():
    for line in (root / '.env').read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.partition('=')
        if separator and key.strip() in {'AI_API_KEY', 'DASHSCOPE_API_KEY', 'SIGNOVA_ACCESS_KEY'}:
            value = value.strip().strip('\"\'')
            if len(value) >= 16:
                secrets.append(value.encode())
for relative, payload in payloads.items():
    if relative == '.env' or any(value in payload for value in secrets):
        raise RuntimeError('Configured credential found in evaluation bundle input; packaging stopped.')
entries = [{'path': relative, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()} for relative, payload in sorted(payloads.items())]
payloads['BUNDLE_MANIFEST.json'] = (json.dumps({'evaluationFingerprint': summary['fingerprint'], 'files': entries}, ensure_ascii=False, indent=2) + '\n').encode()
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for relative, payload in sorted(payloads.items()):
        output.writestr('signova-agent-benchmark/' + relative, payload)
with zipfile.ZipFile(archive) as output:
    if output.testzip() is not None:
        raise RuntimeError('ZIP CRC failed.')
    for entry in entries:
        if hashlib.sha256(output.read('signova-agent-benchmark/' + entry['path'])).hexdigest() != entry['sha256']:
            raise RuntimeError('Bundle content checksum failed.')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / 'signova-agent-benchmark-v2.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='utf-8')
print(json.dumps({'archive': str(archive), 'files': len(payloads), 'bytes': archive.stat().st_size, 'sha256': digest}, ensure_ascii=False))
