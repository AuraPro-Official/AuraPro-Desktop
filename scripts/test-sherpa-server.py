"""Test the embedded server without starting a service or downloading models."""
import ast
import os
import json
import re
from pathlib import Path
import sys
import time
import unittest
from unittest import mock
from functools import lru_cache
from collections import OrderedDict

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.tmp-speech-test'))
import numpy as np

source = (Path(__file__).resolve().parents[1] / 'src/main/utils/sherp_config.ts').read_text(encoding='utf-8')
server = source.split('export const SERVER_SOURCE = String.raw`', 1)[1].rsplit('`', 1)[0]
tree = ast.parse(server)

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail

env = dict(os=os, time=time, json=json, re=re, np=np, lru_cache=lru_cache, OrderedDict=OrderedDict,
           HTTPException=HTTPException, _timed=lambda _: lambda fn: fn)
names = {'_normalize_language_code', '_parse_language_candidates', '_profile_key_for_language',
         '_profile_key_for_tts_language', '_cleanup_asr_stream_state', '_get_asr_stream_key',
         '_resolve_asr_profile_for_request', '_qwen_audio_chunks', 'detect_language_task',
         '_normalize_probability_items', '_best_candidate_from_probs', '_truthy',
         '_create_recognizer', '_create_tts', '_profile_configured', '_profile_value',
         '_fallback_asr_profile', '_fallback_tts_profile', 'get_whisper_large_model', '_require', '_decode_audio', '_qwen_audio_chunks'}
for node in tree.body:
    if isinstance(node, ast.ClassDef) and node.name == 'IndicConformerCTC':
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<server>', 'exec'), env)
    elif isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in
            {'LANGUAGE_ALIASES', 'EU_LANGS', 'ASIA_LANGS', 'HINDI_LANGS', 'OTHER_LANGS', 'ASR_STREAM_MAX_AGE_SECONDS'} for target in node.targets):
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<server>', 'exec'), env)
    elif isinstance(node, ast.FunctionDef) and node.name in names:
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<server>', 'exec'), env)

class RoutingTests(unittest.TestCase):
    def setUp(self):
        env['ASR_STREAM_STATE'] = {}
        env['_load_asr_profiles'] = lambda: {'eu': {}, 'zh': {}, 'asia': {}, 'ar': {}}
        env['_load_tts_profiles'] = lambda: {'en': {}, 'pt-BR': {}, 'pt-PT': {}}
        env['detect_language_task'] = lambda *_: self.fail('Explicit language must bypass detection')

    def test_explicit_language_and_changed_stream(self):
        resolve = env['_resolve_asr_profile_for_request']
        self.assertEqual(resolve(None, [], 'es', stream_id='a')[:2], ('es', 'eu'))
        self.assertEqual(resolve(None, [], 'fr', stream_id='a')[:2], ('fr', 'eu'))

    def test_stream_auto_detection_is_cached(self):
        calls = []
        env['detect_language_task'] = lambda *_: calls.append(1) or 'fr'
        resolve = env['_resolve_asr_profile_for_request']
        resolve(None, [], 'auto', stream_id='a')
        resolve(None, [], 'auto', stream_id='a')
        self.assertEqual(len(calls), 1)
        resolve(None, [], 'auto')
        self.assertEqual(len(calls), 2)

    def test_specialist_language_routes_and_custom_profile_priority(self):
        for language in ('ka', 'hy'):
            self.assertEqual(env['_profile_key_for_language'](language), language)
        env['_load_asr_profiles'] = lambda: {'ka': {'SHERPA_ASR_MODEL': 'custom.onnx'}}
        self.assertEqual(env['_profile_key_for_language']('ka'), 'ka')

    def test_indic_ctc_mask_collapse_blank_and_encoded_length(self):
        model = env['IndicConformerCTC'].__new__(env['IndicConformerCTC'])
        model.vocab = {'hi': ['\u2581hello', 'world'] + [''] * 255}
        model.language_masks = {'hi': list(range(257))}
        model.features = lambda _: np.zeros((10, 80), dtype=np.float32)
        class Encoder:
            def run(self, outputs, inputs):
                self.assert_shape = inputs['audio_signal'].shape
                return np.zeros((1, 8, 7)), np.array([6])
        class Decoder:
            def run(self, *_):
                logits = np.zeros((1, 7, 257), dtype=np.float32)
                for frame, token in enumerate([0, 0, 256, 0, 1, 1, 0]):
                    logits[0, frame, token] = 10
                return [logits]
        model.encoder, model.decoder = Encoder(), Decoder()
        self.assertEqual(model.transcribe(np.ones(16000), 16000, 'hi'), 'hello helloworld')
        self.assertEqual(model.encoder.assert_shape, (1, 80, 10))
        self.assertEqual(env['_decode_audio'](model, np.ones(16000), 16000, 'hi'), 'hello helloworld')
        with self.assertRaises(HTTPException):
            model.transcribe(np.ones(16000), 16000, 'zh')

    def test_regional_tts_does_not_fall_back_to_english(self):
        route = env['_profile_key_for_tts_language']
        self.assertEqual(route('pt_BR'), 'pt-BR')
        self.assertEqual(route('pt-PT'), 'pt-PT')
        self.assertEqual(route('pt'), 'pt-PT')
        self.assertEqual(route('ja'), 'ja')

    def test_additional_reference_tts_routes(self):
        route = env['_profile_key_for_tts_language']
        for name, expected in [('ga', 'ga'), ('tn', 'tn'), ('Cantonese', 'yue'),
                               ('zh-yue', 'yue'), ('粤语', 'yue'), ('Min-nan', 'nan'),
                               ('zh-min-nan', 'nan'), ('閩南語', 'nan')]:
            self.assertEqual(route(name), expected)
        for language in ('ga', 'tn'):
            self.assertEqual(env['_profile_key_for_language'](language), 'others')
        for language in ('yue', 'nan'):
            with self.assertRaises(HTTPException):
                env['_profile_key_for_language'](language)

    def test_long_audio_no_overlap_and_no_loss(self):
        audio = np.ones(16000 * 75, dtype=np.float32)
        chunks = list(env['_qwen_audio_chunks'](audio, 16000))
        self.assertEqual([len(chunk) for chunk in chunks], [480000, 480000, 240000])
        np.testing.assert_array_equal(np.concatenate(chunks), audio)

    def test_long_audio_silence_boundary(self):
        audio = np.ones(16000 * 65, dtype=np.float32)
        audio[16000 * 27:16000 * 28] = 0
        chunks = list(env['_qwen_audio_chunks'](audio, 16000))
        self.assertEqual(len(chunks[0]), 16000 * 28)
        self.assertTrue(all(len(chunk) <= 16000 * 30 for chunk in chunks))
        np.testing.assert_array_equal(np.concatenate(chunks), audio)

    def test_actual_sherpa_interfaces(self):
        import sherpa_onnx
        import inspect
        self.assertEqual(sherpa_onnx.__version__, '1.13.8')
        self.assertIn('tokenizer', inspect.signature(sherpa_onnx.OfflineRecognizer.from_qwen3_asr).parameters)
        sherpa_onnx.OfflineTtsMatchaModelConfig(acoustic_model='', vocoder='', tokens='', lexicon='', dict_dir='')
        sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(), rule_fsts='')

    def test_missing_models_are_not_other_language_fallbacks(self):
        env['_load_asr_profiles'] = lambda: {'default': {'SHERPA_ASR_MODEL': 'chinese.onnx'}}
        env['_load_tts_profiles'] = lambda: {'default': {'SHERPA_TTS_MODEL': 'english.onnx'}}
        for create, args in [('_create_recognizer', ('ar', 'ar')), ('_create_tts', ('ja',))]:
            with self.assertRaises(HTTPException) as raised:
                env[create](*args)
            self.assertEqual(raised.exception.status_code, 503)
        with mock.patch.dict(os.environ, {'SHERPA_ASR_MODEL': 'legacy-chinese.onnx'}):
            self.assertFalse(env['_profile_configured']({}))
            self.assertEqual(env['_profile_value']({}, 'SHERPA_ASR_MODEL'), '')

    def test_configured_detector_is_honored(self):
        env['_env_int'] = lambda _, default: default
        env['WhisperModel'] = lambda name, **_: name
        with mock.patch.dict(os.environ, {'SHERPA_LANG_DETECT_MODEL': 'medium'}):
            env['get_whisper_large_model'].cache_clear()
            self.assertEqual(env['get_whisper_large_model'](), 'medium')
        env['get_whisper_large_model'].cache_clear()

    def test_candidates_choose_probability_not_first(self):
        class Detector:
            def detect_language(self, *_args, **_kwargs):
                return 'es', 0.9, [('en', 0.1), ('es', 0.9)]
        env['get_whisper_small_model'] = lambda: Detector()
        detect_node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'detect_language_task')
        local = dict(env)
        exec(compile(ast.Module(body=[detect_node], type_ignores=[]), '<server>', 'exec'), local)
        self.assertEqual(local['detect_language_task']([], ['en', 'es']), 'es')
        with self.assertRaises(HTTPException):
            local['detect_language_task']([], ['ru', 'fr'])

if __name__ == '__main__':
    unittest.main()
