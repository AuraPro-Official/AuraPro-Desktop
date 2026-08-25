export type AuraPlatform = 'win32' | 'darwin' | 'linux'
export type AuraArchitecture = 'x64' | 'arm64'

const PYTHON_PLATFORM_NAMES: Record<AuraPlatform, string> = {
  win32: 'pc-windows-msvc',
  darwin: 'apple-darwin',
  linux: 'unknown-linux-gnu'
}

const PYTHON_ARCH_NAMES: Record<AuraArchitecture, string> = {
  x64: 'x86_64',
  arm64: 'aarch64'
}

export const getBundledPythonArch = (platform: NodeJS.Platform, architecture: string): string => {
  // Several AI dependencies are still x64-only on Windows. Keep Electron
  // native and use the x64 Python stack through Windows 11 Arm emulation.
  if (platform === 'win32' && architecture === 'arm64') return 'x86_64'
  return PYTHON_ARCH_NAMES[architecture as AuraArchitecture] ?? 'x86_64'
}

export const getBundledPythonTarget = (platform: NodeJS.Platform, architecture: string): string => {
  const platformName = PYTHON_PLATFORM_NAMES[platform as AuraPlatform] ?? 'unknown-linux-gnu'
  return `${getBundledPythonArch(platform, architecture)}-${platformName}`
}

const normalizeMachine = (machine: string): string => {
  const normalized = machine.trim().toLowerCase()
  if (normalized === 'amd64' || normalized === 'x64' || normalized === 'x86_64') return 'x86_64'
  if (normalized === 'arm64' || normalized === 'aarch64') return 'aarch64'
  return normalized
}

export const isBundledPythonMachineCompatible = (
  platform: NodeJS.Platform,
  architecture: string,
  pythonMachine: string
): boolean => normalizeMachine(pythonMachine) === getBundledPythonArch(platform, architecture)

export const getSupportedLlamaVariants = (
  platform: NodeJS.Platform,
  architecture: string
): string[] => {
  if (platform === 'darwin') return ['cpu']
  if (platform === 'win32') {
    return architecture === 'arm64' ? ['cpu'] : ['cpu', 'cuda-12.4', 'cuda-13.3', 'vulkan']
  }
  if (platform === 'linux') {
    return architecture === 'arm64' ? ['cpu', 'vulkan'] : ['cpu', 'vulkan', 'rocm']
  }
  return ['cpu']
}

export const normalizeLlamaVariantForPlatform = (
  variant: string,
  platform: NodeJS.Platform,
  architecture: string
): string => {
  const normalized = variant === 'cuda-13.1' || variant === 'cuda-13.2' ? 'cuda-13.3' : variant
  return getSupportedLlamaVariants(platform, architecture).includes(normalized) ? normalized : 'cpu'
}

export interface LlamaAssetSelection {
  patterns: string[]
  isZip: boolean
}

export const getLlamaAssetPatterns = (
  tag: string,
  variant: string,
  platform: NodeJS.Platform,
  architecture: string
): LlamaAssetSelection => {
  const resolvedVariant = normalizeLlamaVariantForPlatform(variant, platform, architecture)
  const arch = architecture === 'arm64' ? 'arm64' : 'x64'

  if (platform === 'darwin') {
    return { patterns: [`llama-${tag}-bin-macos-${arch}.tar.gz`], isZip: false }
  }

  if (platform === 'linux') {
    if (resolvedVariant === 'vulkan') {
      return { patterns: [`llama-${tag}-bin-ubuntu-vulkan-${arch}.tar.gz`], isZip: false }
    }
    if (resolvedVariant === 'rocm') {
      // The ROCm bundle version changes independently of the llama.cpp build.
      return { patterns: [`llama-${tag}-bin-ubuntu-rocm-*-x64.tar.gz`], isZip: false }
    }
    return { patterns: [`llama-${tag}-bin-ubuntu-${arch}.tar.gz`], isZip: false }
  }

  if (platform === 'win32') {
    if (resolvedVariant === 'cuda-12.4') {
      return { patterns: [`llama-${tag}-bin-win-cuda-12.4-x64.zip`], isZip: true }
    }
    if (resolvedVariant === 'cuda-13.3') {
      return {
        patterns: [
          `llama-${tag}-bin-win-cuda-13.3-x64.zip`,
          `llama-${tag}-bin-win-cuda-13.2-x64.zip`,
          `llama-${tag}-bin-win-cuda-13.1-x64.zip`
        ],
        isZip: true
      }
    }
    if (resolvedVariant === 'vulkan') {
      return { patterns: [`llama-${tag}-bin-win-vulkan-x64.zip`], isZip: true }
    }
    return { patterns: [`llama-${tag}-bin-win-cpu-${arch}.zip`], isZip: true }
  }

  throw new Error(`llama.cpp does not support ${platform}/${architecture}.`)
}

export const matchesAssetPattern = (assetName: string, pattern: string): boolean => {
  if (!pattern.includes('*')) return assetName === pattern
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${expression}$`).test(assetName)
}
