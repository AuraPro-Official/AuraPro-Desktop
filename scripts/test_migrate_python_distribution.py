from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_SCRIPT = ROOT / "resources" / "migrate_python_distribution.py"


def write_distribution(
    site_packages: Path,
    name: str,
    version: str,
    files: dict[str, str],
) -> Path:
    normalized = name.replace("-", "_")
    dist_info = site_packages / f"{normalized}-{version}.dist-info"
    dist_info.mkdir(parents=True, exist_ok=True)
    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.4\nName: {name}\nVersion: {version}\n",
        encoding="utf-8",
    )

    record_paths = list(files)
    record_paths.extend(
        [
            f"{dist_info.name}/METADATA",
            f"{dist_info.name}/RECORD",
        ]
    )
    (dist_info / "RECORD").write_text(
        "".join(f"{item},,\n" for item in record_paths),
        encoding="utf-8",
    )

    for relative_path, content in files.items():
        target = Path(os.path.abspath(site_packages / relative_path))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    return dist_info


class DistributionMigrationTests(unittest.TestCase):
    def test_preserves_shared_replacement_files_and_removes_legacy_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            environment_root = Path(temp_dir)
            site_packages = environment_root / "Lib" / "site-packages"
            site_packages.mkdir(parents=True)

            old_info = write_distribution(
                site_packages,
                "aurapro-ui",
                "3.9.3",
                {
                    "open_webui/shared.py": "old shared",
                    "open_webui/old_only.py": "old only",
                    "../../Scripts/aurapro-ui.exe": "old launcher",
                },
            )
            new_info = write_distribution(
                site_packages,
                "aurapro-webui",
                "3.9.3",
                {
                    "open_webui/shared.py": "new shared",
                    "open_webui/new_only.py": "new only",
                    "../../Scripts/aurapro-webui.exe": "new launcher",
                },
            )

            environment = os.environ.copy()
            environment["PYTHONPATH"] = os.fspath(site_packages)
            result = subprocess.run(
                [
                    sys.executable,
                    os.fspath(MIGRATION_SCRIPT),
                    "aurapro-ui",
                    "aurapro-webui",
                    os.fspath(environment_root),
                ],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            report = json.loads(result.stdout)

            self.assertTrue(report["migrated"])
            self.assertEqual(report["legacy"], "aurapro-ui")
            self.assertEqual(report["legacy_version"], "3.9.3")
            self.assertEqual(report["replacement"], "aurapro-webui")
            self.assertEqual(report["replacement_version"], "3.9.3")
            self.assertFalse(old_info.exists())
            self.assertTrue(new_info.exists())
            self.assertFalse((site_packages / "open_webui" / "old_only.py").exists())
            self.assertTrue((site_packages / "open_webui" / "new_only.py").exists())
            self.assertEqual(
                (site_packages / "open_webui" / "shared.py").read_text(
                    encoding="utf-8"
                ),
                "new shared",
            )
            self.assertFalse((environment_root / "Scripts" / "aurapro-ui.exe").exists())
            self.assertTrue(
                (environment_root / "Scripts" / "aurapro-webui.exe").exists()
            )

            second_result = subprocess.run(
                [
                    sys.executable,
                    os.fspath(MIGRATION_SCRIPT),
                    "aurapro-ui",
                    "aurapro-webui",
                    os.fspath(environment_root),
                ],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertFalse(json.loads(second_result.stdout)["migrated"])

    def test_retains_legacy_metadata_when_a_record_path_is_unsafe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            environment_root = temp_root / "environment"
            site_packages = environment_root / "Lib" / "site-packages"
            site_packages.mkdir(parents=True)
            outside_file = temp_root / "outside.py"
            outside_record_path = os.path.relpath(outside_file, site_packages)

            old_info = write_distribution(
                site_packages,
                "aurapro-ui",
                "3.9.3",
                {outside_record_path: "must not be removed"},
            )
            new_info = write_distribution(
                site_packages,
                "aurapro-webui",
                "3.9.3",
                {"open_webui/new_only.py": "new only"},
            )

            environment = os.environ.copy()
            environment["PYTHONPATH"] = os.fspath(site_packages)
            result = subprocess.run(
                [
                    sys.executable,
                    os.fspath(MIGRATION_SCRIPT),
                    "aurapro-ui",
                    "aurapro-webui",
                    os.fspath(environment_root),
                ],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(outside_file.exists())
            self.assertTrue(old_info.exists())
            self.assertTrue(new_info.exists())


if __name__ == "__main__":
    unittest.main()
