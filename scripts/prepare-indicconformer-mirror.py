"""Stage the authorized IndicConformer CTC files for AuraPro's public mirror."""

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

REPO = "ai4bharat/indic-conformer-600m-multilingual"
GRAPH_NAMES = ("encoder.onnx", "ctc_decoder.onnx")
REQUIRED = (*GRAPH_NAMES, "vocab.json", "language_masks.json")
EXTERNAL_NAME = re.compile(r"[a-z0-9_][a-z0-9_.-]{0,198}[a-z0-9_-]", re.IGNORECASE | re.ASCII)
WINDOWS_DEVICE = re.compile(r"(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)", re.IGNORECASE)
LANGUAGES = "as bn brx doi gu hi kn kok ks mai ml mni mr ne or pa sa sat sd ta te ur".split()


def external_tensor_files(graph):
    from google.protobuf.message import Message
    from onnx import TensorProto

    def visit(message):
        if isinstance(message, TensorProto) and message.data_location == TensorProto.EXTERNAL:
            entries = {entry.key: entry.value for entry in message.external_data}
            name = entries.get("location", "")
            if (
                not EXTERNAL_NAME.fullmatch(name)
                or WINDOWS_DEVICE.match(name)
                or name.lower().endswith((".onnx", ".json", ".ts", ".tmp", ".unverified"))
            ):
                raise ValueError("Unexpected ONNX external tensor filename")
            yield name
        for field, data in message.ListFields():
            if field.message_type is None:
                continue
            if isinstance(data, Message):
                yield from visit(data)
            else:
                for item in data:
                    yield from visit(item)

    return set(visit(graph))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="Full upstream commit SHA")
    parser.add_argument("--output", type=Path, required=True, help="New staging directory")
    parser.add_argument("--license-file", type=Path, required=True, help="Verified model license and copyright notice")
    parser.add_argument("--redistribution-confirmed", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.revision):
        parser.error("--revision must be a full lowercase commit SHA")
    if not args.redistribution_confirmed:
        parser.error("Confirm that redistribution of the selected revision is allowed first")
    if args.output.exists():
        parser.error("--output must be a new directory")
    if not args.license_file.is_file() or not args.license_file.stat().st_size:
        parser.error("Provide the verified, nonempty upstream license and copyright notice")
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        parser.error("Set HF_TOKEN through the private publishing environment")

    from huggingface_hub import hf_hub_download
    from onnx import checker, load_model

    version_dir = args.output / "versions" / args.revision
    assets_dir = version_dir / "assets"
    args.output.mkdir(parents=True, exist_ok=False)

    def stage(name):
        filename = f"assets/{name}"
        source = hf_hub_download(REPO, filename, revision=args.revision, token=token)
        destination = assets_dir / name
        shutil.copyfile(source, destination)
        return destination

    try:
        assets_dir.mkdir(parents=True, exist_ok=False)
        staged = [stage(name) for name in REQUIRED]
        external = set()
        for name in GRAPH_NAMES:
            external.update(external_tensor_files(load_model(assets_dir / name, load_external_data=False)))
        if not external or len(external) != len({name.lower() for name in external}):
            raise ValueError("Expected nonempty ONNX external files with unique filenames on Windows")
        staged.extend(stage(name) for name in sorted(external))
        for name in GRAPH_NAMES:
            checker.check_model(str(assets_dir / name))
        for name in ("vocab.json", "language_masks.json"):
            data = json.loads((assets_dir / name).read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not all(data.get(code) for code in LANGUAGES):
                raise ValueError(f"{name} is missing supported languages")

        entries = []
        for file in staged:
            with file.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            entries.append({
                "path": f"assets/{file.name}",
                "size": file.stat().st_size,
                "sha256": digest,
            })
        manifest = json.dumps({"schemaVersion": 1, "revision": args.revision, "files": entries}, indent=2)
        if (
            len(entries) > 1024
            or any(not item["size"] for item in entries)
            or sum(item["size"] for item in entries) > 8 * 1024**3
            or len(manifest) + 1 > 256 * 1024
        ):
            raise ValueError("Staged model exceeds AuraPro mirror limits or contains an empty file")
        shutil.copyfile(args.license_file, version_dir / "LICENSE")
        (args.output / "manifest.json").write_text(manifest + "\n", encoding="utf-8")
    except Exception:
        shutil.rmtree(args.output)
        raise
    print(f"Staged IndicConformer {args.revision} at {args.output}; no files were uploaded.")


if __name__ == "__main__":
    main()
