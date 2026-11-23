"""Use official Control packages without bootstrapping compilers or system Python."""

import importlib.util
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


MODEL_REPOSITORIES = {
    'unsloth/Qwen3.8-Flash-Next-GGUF',
    'ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF',
    'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
}
READ_ENDPOINTS = {'/health', '/v1/models', '/models', '/props', '/slots', '/v1/status'}
CHAT_ENDPOINTS = {'/v1/chat/completions'}


def configure_managed_setup(setup):
    def no_build(*args, **kwargs):
        raise RuntimeError('No compatible prebuilt Pro runtime. Automatic compiler installation is disabled.')

    def download(url, *args, **kwargs):
        if url != getattr(setup, 'LLAMA_CPP_ZIP', None):
            parsed = urlsplit(url)
            parts = parsed.path.split('/')
            if not (
                parsed.scheme == 'https'
                and parsed.netloc == 'huggingface.co'
                and len(parts) >= 6
                and '/'.join(parts[1:3]) in MODEL_REPOSITORIES
                and parts[3] == 'resolve'
                and re.fullmatch(r'[0-9a-f]{40}', parts[4])
                and parsed.path.endswith('.gguf')
                and setup.file_pin(url)
            ):
                raise RuntimeError('Unsupported download source in managed Pro setup')
        return upstream_download(url, *args, **kwargs)

    upstream_download = setup.download
    setup.download = download
    setup.SOURCES = ('huggingface',)
    setup.model_source = lambda: 'huggingface'
    setup.source_hint = lambda url: ''
    setup.other_installs = lambda settings: []
    # Setup expects a Path for its summary; AuraPro does not need a launch script.
    setup.write_run_script = lambda model, cfg_path, *args, **kwargs: cfg_path
    setup.build_engine = no_build
    setup.build_engine_hip = no_build
    setup.install_build_tools = no_build


def configure_managed_server(server):
    make_handler = server.make_handler

    def make_managed_handler(service):
        class ManagedHandler(make_handler(service)):
            def do_GET(self):
                if self.path.partition('?')[0].rstrip('/') not in READ_ENDPOINTS:
                    return self.send_error(404)
                return super().do_GET()

            def do_POST(self):
                if self.path.partition('?')[0].rstrip('/') not in CHAT_ENDPOINTS:
                    return self.send_error(404)
                return super().do_POST()

            def do_OPTIONS(self):
                return self.send_error(404)

        return ManagedHandler

    load_image = server.Vision.load

    def reject_image_url(_source):
        raise ValueError('Pro accepts embedded images only; attach the image to the chat instead')

    def load_embedded_image(source):
        if not isinstance(source, str) or not re.match(r'^data:image/[\w.+-]+;base64,', source):
            return reject_image_url(source)
        return load_image(source)

    server.make_handler = make_managed_handler
    server.Vision.load = staticmethod(load_embedded_image)
    server.Vision.download = staticmethod(reject_image_url)


def configure_windows_source_paths(setup):
    if not setup.WIN:
        return
    get_llama_cpp = setup.get_llama_cpp

    def get_llama_cpp_with_long_paths():
        original_root = setup.ROOT
        absolute = str(original_root.resolve())
        if absolute.startswith('\\\\?\\'):
            return get_llama_cpp()
        # Source archives contain unused benchmarks exceeding Windows' MAX_PATH.
        extended = '\\\\?\\UNC\\' + absolute[2:] if absolute.startswith('\\\\') else '\\\\?\\' + absolute
        setup.ROOT = Path(extended)
        try:
            result = get_llama_cpp()
            return original_root / result.relative_to(setup.ROOT) if result is not None else None
        finally:
            setup.ROOT = original_root

    setup.get_llama_cpp = get_llama_cpp_with_long_paths


def main():
    root = Path(sys.argv[1]).resolve()
    action = sys.argv[2]
    bundled = (root / 'BUNDLE.json').is_file()
    sys.path.insert(0, str(root))
    if action == 'serve':
        from serve import server
        configure_managed_server(server)
        return server.main(sys.argv[3:])
    if action == 'model':
        if not bundled:
            raise RuntimeError('Update Pro before preparing a model')
        os.environ['STRATA_CONTROL_INSTALL'] = '1'
        os.environ['STRATA_INSTALL_DIR'] = str(root)
        os.environ.pop('STRATA_NO_ACQUIRE', None)
        spec = importlib.util.spec_from_file_location('strata_setup', root / 'setup.py')
        setup = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = setup
        spec.loader.exec_module(setup)
        configure_windows_source_paths(setup)
        configure_managed_setup(setup)
        setup.CONTROL = True
        setup._CONTROL_HOME = root
        sys.argv = [str(root / 'setup.py'), *sys.argv[3:]]
        return setup.main()
    raise ValueError('Expected a bundled Pro install or a managed adapter action')


if __name__ == '__main__':
    sys.exit(main())
