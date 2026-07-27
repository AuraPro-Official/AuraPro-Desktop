from __future__ import annotations

import importlib
import json
import os
import sys
from importlib.metadata import PackageNotFoundError, distribution
from pathlib import Path


def absolute_path(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def prune_empty_parents(start: Path, stop: Path) -> None:
    current = start
    while current != stop and is_within(current, stop):
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def distribution_paths(package_name: str):
    installed = distribution(package_name)
    base = absolute_path(Path(installed.locate_file(".")))
    files = {
        absolute_path(Path(installed.locate_file(item)))
        for item in (installed.files or ())
    }
    return installed, base, files


def remove_legacy_distribution(
    legacy_name: str,
    replacement_name: str,
    environment_root: Path | None = None,
) -> dict[str, object]:
    try:
        legacy, legacy_base, legacy_files = distribution_paths(legacy_name)
    except PackageNotFoundError:
        return {
            "migrated": False,
            "legacy": legacy_name,
            "reason": "not-installed",
        }

    try:
        replacement, replacement_base, replacement_files = distribution_paths(
            replacement_name
        )
    except PackageNotFoundError as error:
        raise RuntimeError(
            f"Replacement distribution {replacement_name!r} is not installed"
        ) from error

    prefix = absolute_path(environment_root or Path(sys.prefix))
    allowed_roots = {prefix, legacy_base, replacement_base}
    legacy_display_name = legacy.metadata.get("Name", legacy_name)
    legacy_version = legacy.version
    replacement_display_name = replacement.metadata.get("Name", replacement_name)
    replacement_version = replacement.version
    shared_files = legacy_files & replacement_files
    removed: list[str] = []
    skipped: list[str] = []

    old_only_files = legacy_files - shared_files
    payload_files = {
        target
        for target in old_only_files
        if not any(
            part.lower().endswith((".dist-info", ".egg-info")) for part in target.parts
        )
    }
    metadata_files = old_only_files - payload_files

    def remove_targets(targets: set[Path]) -> None:
        for target in sorted(targets, key=lambda item: len(item.parts), reverse=True):
            if not any(is_within(target, root) for root in allowed_roots):
                skipped.append(os.fspath(target))
                continue

            try:
                if target.is_file() or target.is_symlink():
                    target.unlink()
                    removed.append(os.fspath(target))
                elif target.is_dir():
                    target.rmdir()
                    removed.append(os.fspath(target))
            except FileNotFoundError:
                continue
            except OSError as error:
                skipped.append(f"{target}: {error}")
                continue

            if is_within(target.parent, legacy_base):
                prune_empty_parents(target.parent, legacy_base)

    remove_targets(payload_files)
    if skipped:
        raise RuntimeError(
            f"Could not remove {len(skipped)} legacy package files; "
            "metadata was retained for a later retry"
        )

    remove_targets(metadata_files)

    importlib.invalidate_caches()
    try:
        distribution(legacy_name)
    except PackageNotFoundError:
        pass
    else:
        raise RuntimeError(
            f"Legacy distribution metadata for {legacy_name!r} is still installed"
        )

    return {
        "migrated": True,
        "legacy": legacy_display_name,
        "legacy_version": legacy_version,
        "replacement": replacement_display_name,
        "replacement_version": replacement_version,
        "shared_files_preserved": len(shared_files),
        "removed_files": len(removed),
        "skipped_files": skipped,
    }


def main() -> int:
    if len(sys.argv) not in {3, 4}:
        print(
            "usage: migrate_python_distribution.py LEGACY REPLACEMENT [ENVIRONMENT_ROOT]",
            file=sys.stderr,
        )
        return 2

    environment_root = Path(sys.argv[3]) if len(sys.argv) == 4 else None
    result = remove_legacy_distribution(
        sys.argv[1],
        sys.argv[2],
        environment_root,
    )
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
