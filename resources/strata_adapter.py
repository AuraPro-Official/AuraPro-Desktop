"""Non-interactive adapter for the pinned Strata setup API.

Keep dependency installation in Pro's private venv. Never silently bootstrap a
compiler/toolkit when a prebuilt runtime is unavailable.
"""

import importlib.util
import json
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
            return original_root / result.relative_to(setup.ROOT)
        finally:
            setup.ROOT = original_root

    setup.get_llama_cpp = get_llama_cpp_with_long_paths


def main():
    root = Path(sys.argv[1]).resolve()
    action = sys.argv[2]
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
        sys.argv = [str(root / 'setup.py'), *sys.argv[3:]]
        return setup.main()
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
