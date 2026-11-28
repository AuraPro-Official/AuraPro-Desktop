# IndicConformer speech model mirror

AuraPro uses the same IndicConformer CTC model for all of its supported Indic speech-recognition languages. Nothing is downloaded for a Chinese-only setup. The desktop only requests public files from `https://aurapro.xmray.de/speech-models/indicconformer/`; it never reads a Hugging Face token for this model.

## Prepare the build

1. Verify that the upstream terms and notices for the selected commit permit redistributing these exact model files. Retain the applicable license and copyright notices. Do not publish while the terms are unclear.
2. In a private publishing environment, install `huggingface_hub` and `onnx` for Python 3.11 or newer. Set `HF_TOKEN` via the environment's secret manager to a read-only token scoped to the upstream repository. The approved publishing account must have access. Do not use this token in desktop build jobs.
3. Run the staging script with a full upstream commit SHA and a new output directory outside the source tree:

   ```text
   python scripts/prepare-indicconformer-mirror.py --revision <40-char-commit-sha> --output <staging-dir> --license-file <verified-license-file> --redistribution-confirmed
   ```

The script downloads the two ONNX graphs, their referenced external tensors, the vocabulary, and the language masks. It does not load upstream Python code, package credentials, or upload anything. It verifies the staged graph references and language files, and records the size and SHA-256 of every shipped model file.

## Deploy

Serve the staging directory at `/speech-models/indicconformer/`. Deploy `versions/<commit>/` (including its license) first. Confirm direct, unauthenticated HTTPS retrieval and byte-range support, then replace `manifest.json` atomically. Never overwrite a version directory with different files. Keep older versions available for in-progress downloads.

For the Nginx host also serving the protected glossaries, use a separate location:

```nginx
location ^~ /speech-models/indicconformer/ {
    alias /srv/aurapro-speech-models/indicconformer/;
    auth_basic off;
    autoindex off;
}
```

Do not remove authentication on the existing glossary locations. The model manifest must return a direct JSON response (no redirect or authentication). Give it a short cache lifetime so a later installation can find the current version.

After deployment, use a clean AuraPro install to select Hindi, Nepali, or Bengali and download the speech-recognition model. Test real recordings in all three languages and confirm a second selection reuses the local model. AuraPro automatically migrates enabled Indic languages after Sherpa starts; the old managed FunASR Nano profile is no longer used. If the mirror is unavailable or verification fails, the affected languages stay unavailable until a retry succeeds. Other languages and TTS continue to use their existing models. **Update speech recognition model** can retry immediately.
