"""Feed a JSON ASR preset on stdin; downloads only that preset into a test cache."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
import time
from urllib.request import urlopen
import wave

from importlib.util import spec_from_file_location, module_from_spec
sys.stdout.reconfigure(encoding='utf-8')

spec = spec_from_file_location('server_tests', Path(__file__).with_name('test-sherpa-server.py'))
tests = module_from_spec(spec)
spec.loader.exec_module(tests)
np = tests.np
preset = json.load(sys.stdin)
repo = preset['repo']
root = Path(__file__).resolve().parents[1] / '.tmp-speech-test' / 'models' / repo.replace('/', '-')
root.mkdir(parents=True, exist_ok=True)

def download(filename, source_repo=None):
    destination = root / filename
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f'Downloading {filename}', flush=True)
    temporary = destination.with_suffix(destination.suffix + '.partial')
    with urlopen(f'https://huggingface.co/{source_repo or repo}/resolve/main/{filename}', timeout=60) as response, temporary.open('wb') as out:
        while chunk := response.read(1024 * 1024):
            out.write(chunk)
    temporary.replace(destination)
    return destination

with urlopen(f'https://huggingface.co/api/models/{repo}', timeout=30) as response:
    metadata = json.load(response)
if preset.get('ttsType') == 'matcha':
    filenames = [file['rfilename'] for file in metadata['siblings'] if file['rfilename'] in {'model-steps-3.onnx', 'tokens.txt', 'lexicon.txt'} or file['rfilename'].endswith(('.fst', '.utf8'))]
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(download, filenames))
    download('hifigan_v2.onnx', 'csukuangfj/sherpa-onnx-hifigan')
    profile = {'SHERPA_TTS_TYPE': 'matcha', 'SHERPA_TTS_MODEL': str(root / 'model-steps-3.onnx'),
               'SHERPA_TTS_TOKENS': str(root / 'tokens.txt'), 'SHERPA_TTS_LEXICON': str(root / 'lexicon.txt'),
               'SHERPA_TTS_DICT_DIR': str(root / 'dict'), 'SHERPA_TTS_VOCODER': str(root / 'hifigan_v2.onnx'),
               'SHERPA_TTS_RULE_FSTS': ','.join(str(root / name) for name in filenames if name.endswith('.fst'))}
    tests.env['_load_tts_profiles'] = lambda: {'zh': profile}
    started = time.perf_counter()
    tts = tests.env['_create_tts']('zh')
    audio = tts.generate('\u8bf7\u4e0d\u8981\u628a\u5341\u4e8c\u70b9\u5341\u4e94\u5206\u542c\u6210\u4e24\u70b9\u5341\u4e94\u5206\u3002', sid=0, speed=1)
    assert len(audio.samples) > audio.sample_rate and np.std(audio.samples) > 0.001
    print(json.dumps({'tts': repo, 'seconds': time.perf_counter() - started, 'audio_seconds': len(audio.samples) / audio.sample_rate}))
    sys.exit(0)
samples = [file['rfilename'] for file in metadata['siblings'] if file['rfilename'].endswith('.wav')][:4]
filenames = [file['filename'] for file in preset['files']] + samples
with ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(download, filenames))

profile = {'SHERPA_ASR_NAME': preset['id'], 'SHERPA_ASR_TYPE': preset['asrType'], 'SHERPA_ASR_PROVIDER': 'cpu', 'SHERPA_ASR_NUM_THREADS': '2'}
for file in preset['files']:
    key = 'SHERPA_ASR_' + file['field'][3:].upper()
    if key == 'SHERPA_ASR_CONVFRONTEND':
        key = 'SHERPA_ASR_CONV_FRONTEND'
    if key == 'SHERPA_ASR_TOKENIZER':
        profile[key] = str((root / file['filename']).parent)
    else:
        profile[key] = str(root / file['filename'])
tests.env['_load_asr_profiles'] = lambda: {'test': profile}
started = time.perf_counter()
recognizer = tests.env['_create_recognizer']('test', preset.get('language', ''))
print(f'Loaded {repo} in {time.perf_counter() - started:.2f}s', flush=True)
report = []
for filename in samples:
    with wave.open(str(root / filename)) as audio:
        rate = audio.getframerate()
        if audio.getsampwidth() != 2 or audio.getnchannels() != 1:
            raise ValueError('Fixture must be mono PCM16')
        data = np.frombuffer(audio.readframes(audio.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    started = time.perf_counter()
    chunks = tests.env['_qwen_audio_chunks'](data, rate) if preset['asrType'] == 'qwen3_asr' else [data]
    text = ' '.join(tests.env['_decode_audio'](recognizer, chunk, rate) for chunk in chunks)
    assert text.strip(), f'Empty transcription: {filename}'
    result = {'fixture': filename, 'seconds': round(time.perf_counter() - started, 3), 'text': text}
    report.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
(root / 'smoke-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
