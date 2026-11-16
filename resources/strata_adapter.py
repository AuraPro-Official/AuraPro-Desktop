"""Use official Control packages without bootstrapping compilers or system Python."""

import importlib.util
import json
import os
import sys
from pathlib import Path


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
    if bundled and action == 'model':
        os.environ['STRATA_CONTROL_INSTALL'] = '1'
        os.environ['STRATA_INSTALL_DIR'] = str(root)
        os.environ.pop('STRATA_NO_ACQUIRE', None)
    sys.path.insert(0, str(root))
    spec = importlib.util.spec_from_file_location('strata_setup', root / 'setup.py')
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    configure_windows_source_paths(setup)

    def no_build(*args, **kwargs):
        raise RuntimeError('No compatible prebuilt Pro runtime. Automatic compiler installation is disabled.')

    setup.build_engine = no_build
    setup.build_engine_hip = no_build
    setup.install_build_tools = no_build
    if action == 'model':
        if bundled:
            setup.CONTROL = True
            setup._CONTROL_HOME = root
        sys.argv = [str(root / 'setup.py'), *sys.argv[3:]]
        return setup.main()
    if action in ('install', 'check') and bundled:
        from strata_cli.cli import main as cli_main
        from strata_control import engine_component as ec
        backend = sys.argv[3]
        args = ['update', '--no-control', '--yes', '--output', 'jsonl']
        if len(sys.argv) > 4:
            args += ['--feed', 'https://github.com/Niko1221/Strata/releases/download/' + sys.argv[4] + '/strata-feed.json']
        if backend != 'auto':
            args += ['--backend', backend]
        if action == 'check':
            args += ['--check']
        # The official updater verifies the signed feed, archives, GPU support and rollback.
        code = cli_main(args)
        if code:
            return code
        if action == 'check':
            from strata_control.updater import State
            state = State(ec.components_dir()).section('last_check')
            result = {'available': bool(state.get('engine'))}
        else:
            component = ec.resolve(backend=None if backend == 'auto' else backend, full=True)
            result = {'version': component.version, 'backend': component.backend,
                      'control': (root / 'VERSION').read_text(encoding='utf-8-sig').strip()}
        print('AURAPRO_RESULT:' + json.dumps(result), flush=True)
        return 0
    if action != 'install':
        raise ValueError('Unknown adapter action')

    backend = sys.argv[3]
    _, avx2, _ = setup.cpu_info()
    if not avx2:
        raise RuntimeError('Pro requires an AVX2-capable CPU')
    nvidia = [gpu for gpu in setup.gpus() if setup.gpu_problem(gpu) is None]
    amd = [gpu for gpu in setup.amd_gpus() if setup.amd_problem(gpu) is None]
    hip = backend == 'hip' or (backend == 'auto' and not nvidia and bool(amd))
    cards = amd if hip else nvidia
    if not cards:
        raise RuntimeError('No supported GPU/driver for the selected Pro backend')
    print('AURAPRO_STAGE:dependencies', flush=True)
    setup.pip_install(setup.requirement_lines(), 'Pro Python dependencies')
    gpu = max(cards, key=lambda card: card['vram_gb'])
    print('AURAPRO_STAGE:runtime', flush=True)
    if hip:
        if not setup.WIN:
            raise RuntimeError(
                'Linux HIP currently requires a source build; managed Pro supports prebuilt runtimes only'
            )
        engine = setup.get_prebuilt_hip(setup.PREBUILT_URL, gpu)
    else:
        engine = setup.get_prebuilt(setup.PREBUILT_URL, gpu, 'none')
        if engine:
            print('AURAPRO_STAGE:cuda', flush=True)
            setup.pip_install(setup.CUDA_WHEELS, 'Pro CUDA libraries')
    if not engine:
        no_build()
    meta = json.loads((engine / 'BUILD.json').read_text(encoding='utf-8'))
    print(json.dumps({'version': meta.get('version'), 'backend': 'hip' if hip else 'cuda'}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
