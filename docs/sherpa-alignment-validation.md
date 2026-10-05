# Sherpa Speech Alignment Validation

This change does not update the application version or publish a release.

## Implemented

- Chinese STT preset is unchanged; configured user models and voices retain priority.
- Explicit request language overrides detection and the WebUI global default.
- Automatic streaming detection is cached for an utterance; the final recording is detected independently.
- European languages share Parakeet TDT v3 int8. Russian uses punctuation GigaAM v3; Filipino uses FastConformer; Asian routing uses Dolphin small int8; other listed languages use Omnilingual 300M int8.
- Arabic uses Qwen3-ASR ONNX inside Sherpa, with non-overlapping audio chunks no longer than 30 seconds, preferring quiet boundaries.
- Georgian (`ka`) and Armenian (`hy`) use dedicated FastConformer ONNX transducers for new language profiles. Existing profiles remain unchanged, including manually selected recognizers.
- Indic languages now share AI4Bharat Indic Conformer 600M with the reference project's CTC feature settings, language masks and greedy decoding inside the existing service. Managed FunASR Indic defaults are replaced after successful setup; manually specified models retain priority. No MLX, CUDA Whisper or additional llama.cpp service is introduced.
- Indic downloads include ONNX external tensor files and do not read user HF_TOKEN values. Metadata or file download failures trigger the legacy FunASR Nano int8 fallback with an explicit warning about incomplete Indic language coverage. Fallback profiles are marked to avoid retrying the restricted model on every launch. Failed primary and fallback downloads do not persist partial profiles. No built-in credential was added: credential embedding was blocked by security review. Indic dependencies are installed only for selected Indic languages; Intel macOS pins ONNX Runtime 1.23.2 and Kaldi native fbank pins 1.22.3.
- Sherpa CPU dependency is pinned to 1.13.8; Windows ARM64 Python selection is unchanged.
- Enabled languages are selectable before first installation and in Speech settings. Download status checks files on disk.
- Downloads are serialized across ASR/TTS setup and limited to two active files. Deselecting languages never removes files.
- New TTS defaults cover 46 languages plus Portuguese regional variants. Matcha includes its vocoder, lexicon, dictionary and text rules.
- Missing language models return actionable errors instead of falling back to another language.

## Reference Deviation

The reference's `csukuangfj/kokoro-en-v0_19` repository contains only `.gitattributes` and cannot supply a complete model. New English installations use publicly downloadable `csukuangfj/kokoro-multi-lang-v1_1`, restricted to the English profile. Existing English voice profiles are not overwritten.

## Completed Checks

- TypeScript main-process typecheck and ESLint passed.
- Svelte check: zero errors; existing tsconfig project-reference warning remains.
- Automated routing, model setup, concurrency and Chinese-preset preservation tests passed.
- Sherpa 1.13.8 Qwen and Matcha constructor interfaces verified using its installed CPU wheel in an isolated test directory.
- Public Parakeet German, English, Spanish and French recordings produced nonempty transcriptions.
- Public GigaAM Russian recording produced a nonempty, punctuated transcription.
- Public Qwen Arabic and additional sample recordings produced nonempty transcriptions.
- Dolphin public sample decoded successfully. Filipino FastConformer loaded successfully, but its repository supplies no test recordings.
- Georgian FastConformer Hybrid Large PC loaded through the embedded server adapter in 0.81 seconds; Armenian FastConformer Hybrid loaded in 0.70 seconds (Windows CPU, Sherpa 1.13.8). Both repositories supply no audio fixtures, so recognition accuracy is not validated. Model attribution and declared CC BY 4.0 licenses are recorded in THIRD_PARTY_SPEECH_NOTICES.txt; the Armenian publisher's model card does not identify the original training author.
- Matcha generated 3.57 seconds of non-silent audio from a Chinese sentence containing a time and negation. Upstream lexicon warnings about `shei2` were observed, without stopping synthesis.
- Language selection, save and deselection passed Playwright checks. Screenshots at widths 1280, 640 and 360 had no horizontal overflow.
- PyPI metadata provides Python 3.12 wheels for Windows, macOS and Linux on x64/ARM64. This is metadata verification, not an execution test on all six platforms.

## Remaining Acceptance Work

Do not claim an accuracy improvement from the smoke tests above. A matched before/after corpus covering Chinese, English, Spanish, French, Russian and Filipino, including noise, numbers, negation and long recordings, has not been run.

Real first-install, interrupted-download retry, offline restart and full preview/final-recognition integration need testing in packaged applications. macOS/Linux execution and perceptual TTS language/voice quality have not been validated on physical systems.

Indic CTC routing, external-data download deduplication, managed-default replacement and synthetic masked CTC decoding tests pass. An unauthenticated request for the upstream vocabulary returned HTTP 401; actual Indic model loading and recording recognition are not validated without authorized model access. Kaldi 1.22.3 wheel metadata covers Python 3.12 Windows x64, macOS x64/ARM64 and Linux x64/ARM64; Windows ARM64 continues to use the existing x64 Python strategy. The local Python 3.14 smoke environment has no Kaldi 1.22.3 wheel, so real feature extraction there was not tested.

## Reproduction

Run `node --test scripts/test-speech-language-presets.mjs scripts/test-speech-model-setup.mjs`, `python scripts/test-sherpa-server.py`, and `node scripts/test-speech-ui.mjs` from the desktop repository.

The Python tests require numpy and sherpa-onnx 1.13.8 in the active environment or `.tmp-speech-test`. The browser test uses an installed Chrome by default. Isolated model artifacts and screenshots are ignored by Git and excluded from desktop packaging.
