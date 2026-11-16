import importlib.util
import os
import shutil
import tempfile
import types
import unittest
from unittest.mock import patch
import sys
import zipfile
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    'strata_adapter', Path(__file__).parents[1] / 'resources/strata_adapter.py'
)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class WindowsSourcePathsTest(unittest.TestCase):
    def test_control_setup_without_source_download(self):
        setup = types.SimpleNamespace(WIN=True, ROOT=Path('source'), get_llama_cpp=lambda: None)
        adapter.configure_windows_source_paths(setup)
        self.assertIsNone(setup.get_llama_cpp())
        self.assertEqual(setup.ROOT, Path('source'))

    def test_non_windows_unchanged(self):
        original = lambda: None
        setup = types.SimpleNamespace(WIN=False, get_llama_cpp=original)
        adapter.configure_windows_source_paths(setup)
        self.assertIs(setup.get_llama_cpp, original)

    def test_root_restored_after_error(self):
        original_root = Path('source')
        setup = types.SimpleNamespace(WIN=True, ROOT=original_root)

        def fail():
            self.assertTrue(str(setup.ROOT).startswith('\\\\?\\'))
            raise RuntimeError('download failed')

        setup.get_llama_cpp = fail
        adapter.configure_windows_source_paths(setup)
        with self.assertRaisesRegex(RuntimeError, 'download failed'):
            setup.get_llama_cpp()
        self.assertEqual(setup.ROOT, original_root)

    @unittest.skipUnless(os.name == 'nt', 'Windows filesystem regression')
    def test_long_archive_path_extract_move_cleanup_and_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / ('version-' + 'a' * 72)
            root.mkdir()
            archive = root / 'source.zip'
            member = 'llama.cpp-' + 'b' * 40 + '/benches/dgx-spark/' + 'benchmark-' * 12 + '.html'
            with zipfile.ZipFile(archive, 'w') as output:
                output.writestr(member, 'benchmark data')
                output.writestr('llama.cpp-' + 'b' * 40 + '/ggml/CMakeLists.txt', 'cmake')
            self.assertGreater(len(str(root / 'third_party/_unpack' / member)), 260)
            setup = types.SimpleNamespace(WIN=True, ROOT=root)

            def extract():
                unpack = setup.ROOT / 'third_party/_unpack'
                shutil.rmtree(unpack, ignore_errors=True)
                with zipfile.ZipFile(setup.ROOT / 'source.zip') as source:
                    source.extractall(unpack)
                target = setup.ROOT / 'third_party/llama.cpp'
                shutil.rmtree(target, ignore_errors=True)
                shutil.move(str(next(unpack.iterdir())), str(target))
                shutil.rmtree(unpack)
                return target

            setup.get_llama_cpp = extract
            adapter.configure_windows_source_paths(setup)
            try:
                for _ in range(2):
                    result = setup.get_llama_cpp()
                    self.assertEqual(result, root / 'third_party/llama.cpp')
                    self.assertEqual(setup.ROOT, root)
                    self.assertEqual((result / 'ggml/CMakeLists.txt').read_text(), 'cmake')
            finally:
                shutil.rmtree('\\\\?\\' + str(root.resolve()))


class ControlAdapterTest(unittest.TestCase):
    def test_control_environment_is_set_before_setup_import(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / 'BUNDLE.json').write_text('{}')
            (root / 'setup.py').write_text(
                'import os\n'
                'assert os.environ["STRATA_CONTROL_INSTALL"] == "1"\n'
                'assert os.environ["STRATA_INSTALL_DIR"] == str(__import__("pathlib").Path(__file__).parent)\n'
                'assert "STRATA_NO_ACQUIRE" not in os.environ\n'
                'WIN = False\n'
                'def main():\n'
                '    assert CONTROL is True\n'
                '    return 0\n'
            )
            with patch.dict(os.environ, {'STRATA_NO_ACQUIRE': '1'}), patch.object(
                sys, 'argv', ['adapter', str(root), 'model', '--setup']
            ), patch.object(sys, 'path', list(sys.path)):
                self.assertEqual(adapter.main(), 0)


if __name__ == '__main__':
    unittest.main()
