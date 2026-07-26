import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import { execFileSync, execSync } from 'child_process'

import log from 'electron-log'

import { getConfig, getInstallDir, setConfig } from './index'
import { downloadModel, getModelsDir, listModels, type HfModel } from './huggingface'
import {
  getLlamaCppInfo,
  getLlamaCppLog,
  reinstallLlamaCpp,
  setupLlamaCpp,
  startLlamaCppWithFallback,
  stopLlamaCpp
} from './llamacpp'
import {
  classifyLlamaCppLog,
  inspectLlamaCppGpuLog,
  inspectLlamaCppMainModelLog,
  inspectLlamaCppMtpLog,
  inspectLlamaCppMultimodalLog
} from './llamacpp-log-diagnostics'

export type LlamaDiagnosticSeverity = 'error' | 'warning' | 'info'
export type LlamaRepairAction =
  | 'switch-variant'
  | 'reinstall-llamacpp'
  | 'repair-runtime'
  | 'repair-model'
  | 'repair-mmproj'
  | 'repair-mtp'
  | 'disable-mtp'
  | 'restart'

export interface LlamaDiagnosticIssue {
  id: string
  severity: LlamaDiagnosticSeverity
  title: string
  detail: string
  repairable: boolean
  action?: LlamaRepairAction
  data?: Record<string, unknown>
}

export interface LlamaDiagnosticReport {
  checkedAt: string
  trigger: string
  healthy: boolean
  fingerprint: string
  variant: string
  recommendedVariant: string
  hardware: {
    nvidiaDetected: boolean
    gpuNames: string[]
    driverVersion: string | null
    processOnGpu: boolean | null
    totalRamBytes: number
    freeRamBytes: number
    totalVramMb: number | null
    freeVramMb: number | null
  }
  runtime: {
    status: string | null
    version: string | null
    binaryPath: string | null
    binaryPresent: boolean
    acceleratorBackendPresent: boolean
    cudaBackendPresent: boolean
    cudaRuntimePresent: boolean
    cudaDeviceCount: number | null
    offloadedLayers: number | null
  }
  models: {
    total: number
    invalid: number
    partial: number
    mtpEnabled: boolean
    mtpMissing: number
    visionProjectorMissing: number
  }
  issues: LlamaDiagnosticIssue[]
  evidence: string[]
}

export interface LlamaRepairResult {
  actions: string[]
  restartError: string | null
  report: LlamaDiagnosticReport
}

interface NvidiaProbe {
  detected: boolean
  names: string[]
  driverVersion: string | null
  smiPath: string | null
  adapters: string
  totalVramMb: number | null
  freeVramMb: number | null
}

interface NvidiaProcessUsage {
  active: boolean | null
  usedMemoryMb: number | null
}

interface OfficialModelSource {
  repo: string
  filename: string
  saveAs: string
  expectedSize: number
}

interface CompanionModelSource {
  repo: string
  filename: string
}

const GB = 1024 * 1024 * 1024

const OFFICIAL_MODEL_SOURCES: Record<string, OfficialModelSource> = {
  'lowest.gguf': {
    repo: 'unsloth/gemma-4-E2B-it-GGUF',
    filename: 'gemma-4-E2B-it-UD-Q4_K_XL.gguf',
    saveAs: 'lowest.gguf',
    expectedSize: 4 * GB
  },
  'low_EQ4_MAC_8G.gguf': {
    repo: 'unsloth/gemma-4-E4B-it-GGUF',
    filename: 'gemma-4-E4B-it-IQ4_XS.gguf',
    saveAs: 'low_EQ4_MAC_8G.gguf',
    expectedSize: 4.72 * GB
  },
  'low_E4.gguf': {
    repo: 'unsloth/gemma-4-E4B-it-GGUF',
    filename: 'gemma-4-E4B-it-UD-Q4_K_XL.gguf',
    saveAs: 'low_E4.gguf',
    expectedSize: 5 * GB
  },
  'medium_IQ2.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'gemma-4-26B-A4B-it-UD-Q2_K_XL.gguf',
    saveAs: 'medium_IQ2.gguf',
    expectedSize: 11 * GB
  },
  'medium_Q4.gguf': {
    repo: 'unsloth/gemma-4-12b-it-GGUF',
    filename: 'gemma-4-12b-it-UD-Q4_K_XL.gguf',
    saveAs: 'medium_Q4.gguf',
    expectedSize: 8 * GB
  },
  'high_IQ4.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'gemma-4-26B-A4B-it-UD-IQ4_XS.gguf',
    saveAs: 'high_IQ4.gguf',
    expectedSize: 14 * GB
  },
  'high_Q4.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf',
    saveAs: 'high_Q4.gguf',
    expectedSize: 17 * GB
  },
  'high_Q5.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'gemma-4-26B-A4B-it-UD-Q5_K_XL.gguf',
    saveAs: 'high_Q5.gguf',
    expectedSize: 22 * GB
  },
  'high-code_IQ4.gguf': {
    repo: 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
    filename: 'Qwen3.6-35B-A3B-UD-IQ4_NL.gguf',
    saveAs: 'high-code_IQ4.gguf',
    expectedSize: 19 * GB
  }
}

const MTP_SOURCES: Record<string, { repo: string; filename: string }> = {
  'medium_IQ2.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mtp-gemma-4-26B-A4B-it.gguf'
  },
  'medium_Q4.gguf': {
    repo: 'unsloth/gemma-4-12b-it-GGUF',
    filename: 'mtp-gemma-4-12b-it.gguf'
  },
  'high_IQ4.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mtp-gemma-4-26B-A4B-it.gguf'
  },
  'high_Q4.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mtp-gemma-4-26B-A4B-it.gguf'
  },
  'high_Q5.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mtp-gemma-4-26B-A4B-it.gguf'
  }
}

const MMPROJ_SOURCES: Record<string, CompanionModelSource> = {
  'lowest.gguf': {
    repo: 'unsloth/gemma-4-E2B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'low_EQ4_MAC_8G.gguf': {
    repo: 'unsloth/gemma-4-E4B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'low_E4.gguf': {
    repo: 'unsloth/gemma-4-E4B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'medium_IQ2.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'medium_Q4.gguf': {
    repo: 'unsloth/gemma-4-12b-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'high_IQ4.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'high_Q4.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'high_Q5.gguf': {
    repo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
    filename: 'mmproj-F16.gguf'
  },
  'high-code_IQ4.gguf': {
    repo: 'unsloth/Qwen3.6-35B-A3B-GGUF',
    filename: 'mmproj-F16.gguf'
  }
}

const normalizeVariant = (variant: string | undefined): string => {
  if (!variant || variant === 'auto') return 'auto'
  if (variant === 'cuda-13.1' || variant === 'cuda-13.2') return 'cuda-13.3'
  return variant
}

const compareVersions = (left: string, right: string): number => {
  const a = left.split('.').map((value) => Number.parseInt(value, 10) || 0)
  const b = right.split('.').map((value) => Number.parseInt(value, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0)
  }
  return 0
}

const nvidiaSmiPaths = (): string[] => [
  'nvidia-smi',
  path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
  path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'NVIDIA Corporation',
    'NVSMI',
    'nvidia-smi.exe'
  )
]

const probeNvidia = (): NvidiaProbe => {
  let adapters = ''
  if (process.platform === 'win32') {
    try {
      adapters = execSync('wmic path win32_VideoController get name', {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      })
    } catch {
      // Fall back to nvidia-smi when WMIC is unavailable.
    }
  }

  for (const smiPath of nvidiaSmiPaths()) {
    try {
      const output = execFileSync(
        smiPath,
        [
          '--query-gpu=name,driver_version,memory.total,memory.free',
          '--format=csv,noheader,nounits'
        ],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      )
      const rows = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const names: string[] = []
      let driverVersion: string | null = null
      let totalVramMb = 0
      let freeVramMb = 0
      for (const row of rows) {
        const [name, driver, totalMemory, freeMemory] = row.split(',').map((value) => value.trim())
        if (name) names.push(name)
        if (!driverVersion && driver) driverVersion = driver
        totalVramMb += Number.parseInt(totalMemory, 10) || 0
        freeVramMb += Number.parseInt(freeMemory, 10) || 0
      }
      if (names.length > 0) {
        return {
          detected: true,
          names,
          driverVersion,
          smiPath,
          adapters,
          totalVramMb: totalVramMb || null,
          freeVramMb: freeVramMb || null
        }
      }
    } catch {
      // Try the next known nvidia-smi location.
    }
  }

  const fallbackNames = adapters
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /nvidia|geforce|rtx/i.test(line) && !/^name$/i.test(line))
  return {
    detected: fallbackNames.length > 0,
    names: fallbackNames,
    driverVersion: null,
    smiPath: null,
    adapters,
    totalVramMb: null,
    freeVramMb: null
  }
}

const recommendedVariantFor = (probe: NvidiaProbe): string => {
  if (probe.detected) {
    return probe.names.some((name) => /\brtx\s+50[5-9]0\b/i.test(name)) ? 'cuda-13.3' : 'cuda-12.4'
  }
  const adapters = probe.adapters.toLowerCase()
  if (
    adapters.includes('amd') ||
    adapters.includes('radeon') ||
    adapters.includes('intel arc') ||
    adapters.includes('iris xe max')
  ) {
    return 'vulkan'
  }
  return 'cpu'
}

const adapterNamesFromProbe = (probe: NvidiaProbe): string[] =>
  probe.adapters
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^name$/i.test(line))

const findFileBesideBinary = (binary: string | null, prefix: string): boolean => {
  if (!binary) return false
  try {
    return fs
      .readdirSync(path.dirname(binary))
      .some((filename) => filename.toLowerCase().startsWith(prefix.toLowerCase()))
  } catch {
    return false
  }
}

const findLibraryBesideBinary = (binary: string | null, fragment: string): boolean => {
  if (!binary) return false
  try {
    return fs
      .readdirSync(path.dirname(binary))
      .some((filename) => filename.toLowerCase().includes(fragment.toLowerCase()))
  } catch {
    return false
  }
}

const hasAcceleratorBackend = (binary: string | null, variant: string): boolean => {
  if (variant.startsWith('cuda-')) return findLibraryBesideBinary(binary, 'ggml-cuda')
  if (variant === 'vulkan') return findLibraryBesideBinary(binary, 'ggml-vulkan')
  if (variant === 'rocm') {
    return (
      findLibraryBesideBinary(binary, 'ggml-hip') || findLibraryBesideBinary(binary, 'ggml-rocm')
    )
  }
  return true
}

const hasCudaRuntime = (binary: string | null, variant: string): boolean => {
  if (!binary) return false
  const major = variant.startsWith('cuda-13') ? '13' : '12'
  return [`cudart64_${major}`, `cublas64_${major}`, `cublaslt64_${major}`].every((prefix) =>
    findFileBesideBinary(binary, prefix)
  )
}

const isGgufValid = (filepath: string): boolean => {
  try {
    if (!fs.existsSync(filepath) || fs.statSync(filepath).size < 8) return false
    const descriptor = fs.openSync(filepath, 'r')
    try {
      const header = Buffer.alloc(4)
      fs.readSync(descriptor, header, 0, 4, 0)
      return header.toString('ascii') === 'GGUF'
    } finally {
      fs.closeSync(descriptor)
    }
  } catch {
    return false
  }
}

const findCompanionGguf = (
  directory: string,
  preferredFilename: string,
  prefix: string
): string => {
  const preferred = path.join(directory, preferredFilename)
  if (fs.existsSync(preferred)) return preferred
  try {
    const fallback = fs.readdirSync(directory, { withFileTypes: true }).find((entry) => {
      const name = entry.name.toLowerCase()
      return entry.isFile() && name.startsWith(prefix) && name.endsWith('.gguf')
    })
    return fallback ? path.join(directory, fallback.name) : preferred
  } catch {
    return preferred
  }
}

const hasCompanionPartial = (directory: string, prefix: string): boolean => {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
      const name = entry.name.toLowerCase()
      return entry.isFile() && name.startsWith(prefix) && name.endsWith('.gguf.tmp')
    })
  } catch {
    return false
  }
}

const absoluteModelPath = (model: HfModel): string => {
  return path.normalize(
    path.isAbsolute(model.filepath) ? model.filepath : path.join(getInstallDir(), model.filepath)
  )
}

const findModelReferencedInLogs = (logs: string, models: HfModel[]): HfModel | null => {
  const normalizedLogs = logs.toLowerCase().replace(/\\/g, '/')
  let match: HfModel | null = null
  let matchIndex = -1
  for (const model of models) {
    const filepath = absoluteModelPath(model)
    const normalizedPath = filepath.toLowerCase().replace(/\\/g, '/')
    const filename = path.basename(filepath).toLowerCase()
    const index = Math.max(
      normalizedLogs.lastIndexOf(normalizedPath),
      normalizedLogs.lastIndexOf(filename)
    )
    if (index > matchIndex) {
      match = model
      matchIndex = index
    }
  }
  return match ?? (models.length === 1 ? models[0] : null)
}

const findOfficialModelNameInLogs = (logs: string): string | null => {
  const lowerLogs = logs.toLowerCase()
  let match: string | null = null
  let matchIndex = -1
  for (const filename of Object.keys(OFFICIAL_MODEL_SOURCES)) {
    const index = lowerLogs.lastIndexOf(filename.toLowerCase())
    if (index > matchIndex) {
      match = filename
      matchIndex = index
    }
  }
  return match
}

const listPartialGgufFiles = (root: string): string[] => {
  const files: string[] = []
  const scan = (dir: string): void => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const filepath = path.join(dir, entry.name)
        if (entry.isDirectory()) scan(filepath)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf.tmp'))
          files.push(filepath)
      }
    } catch {
      // Ignore inaccessible model-cache directories.
    }
  }
  if (fs.existsSync(root)) scan(root)
  return files
}

const probeNvidiaProcessUsage = (probe: NvidiaProbe, pid: number | null): NvidiaProcessUsage => {
  if (!probe.smiPath) return { active: null, usedMemoryMb: null }
  try {
    const output = execFileSync(
      probe.smiPath,
      ['--query-compute-apps=pid,process_name,used_gpu_memory', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    )
    const matches = output
      .split(/\r?\n/)
      .map((line) => line.split(',').map((part) => part.trim()))
      .filter((parts) => {
        const processPid = Number.parseInt(parts[0] ?? '', 10)
        const processName = parts.slice(1, -1).join(',')
        return (
          (Boolean(pid) && processPid === pid) ||
          /(?:^|[\\/])llama-server(?:\.exe)?$/i.test(processName)
        )
      })

    const usedMemoryMb = matches
      .map((parts) => Number.parseFloat(parts[parts.length - 1] ?? ''))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((total, value) => total + value, 0)

    return {
      active: matches.length > 0,
      usedMemoryMb: usedMemoryMb > 0 ? usedMemoryMb : null
    }
  } catch {
    try {
      const output = execFileSync(
        probe.smiPath,
        ['--query-compute-apps=pid,process_name', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      )
      const active = output.split(/\r?\n/).some((line) => {
        const separator = line.indexOf(',')
        const processPid = Number.parseInt(
          separator >= 0 ? line.slice(0, separator).trim() : '',
          10
        )
        const processName = separator >= 0 ? line.slice(separator + 1).trim() : ''
        return (
          (Boolean(pid) && processPid === pid) ||
          /(?:^|[\\/])llama-server(?:\.exe)?$/i.test(processName)
        )
      })
      return { active, usedMemoryMb: null }
    } catch {
      return { active: null, usedMemoryMb: null }
    }
  }
}

const addIssue = (issues: LlamaDiagnosticIssue[], issue: LlamaDiagnosticIssue): void => {
  if (!issues.some((existing) => existing.id === issue.id)) issues.push(issue)
}

const ANSI_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g'
)
const stripAnsi = (value: string): string => value.replace(ANSI_SEQUENCE, '')

const errorRecord = (
  error: unknown
): {
  message?: string
  stdout?: { toString(): string } | string
  stderr?: { toString(): string } | string
} =>
  error && typeof error === 'object'
    ? (error as {
        message?: string
        stdout?: { toString(): string } | string
        stderr?: { toString(): string } | string
      })
    : { message: String(error) }

export const diagnoseLlamaCpp = async (
  trigger = 'manual',
  startupError?: string
): Promise<LlamaDiagnosticReport> => {
  const config = await getConfig()
  const configuredVariant = normalizeVariant(config.llamaCpp?.variant)
  const probe = probeNvidia()
  const recommendedVariant = recommendedVariantFor(probe)
  const variant = configuredVariant === 'auto' ? recommendedVariant : configuredVariant
  const info = getLlamaCppInfo()
  const binary = info.binaryPath && fs.existsSync(info.binaryPath) ? info.binaryPath : null
  const binaryPresent = Boolean(binary)
  const acceleratorBackendPresent = Boolean(binary && hasAcceleratorBackend(binary, variant))
  const cudaBackendPresent = Boolean(binary && findLibraryBesideBinary(binary, 'ggml-cuda'))
  const cudaRuntimePresent = variant.startsWith('cuda-') ? hasCudaRuntime(binary, variant) : true
  const issues: LlamaDiagnosticIssue[] = []
  const totalRamBytes = os.totalmem()
  const freeRamBytes = os.freemem()
  const evidence: string[] = [
    `System memory free: ${(freeRamBytes / 1024 ** 3).toFixed(1)} / ${(totalRamBytes / 1024 ** 3).toFixed(1)} GiB`
  ]

  if (probe.detected && variant === 'cpu' && process.platform === 'win32') {
    evidence.push(`NVIDIA GPU available for acceleration: ${probe.names.join(', ')}`)
    addIssue(issues, {
      id: 'nvidia-cpu-variant',
      severity: 'warning',
      title: 'NVIDIA GPU available while CPU variant is selected',
      detail: `${probe.names[0]} can use ${recommendedVariant} for substantially faster inference, but the CPU variant is selected.`,
      repairable: true,
      action: 'switch-variant',
      data: { targetVariant: recommendedVariant }
    })
  }

  if (variant.startsWith('cuda-')) {
    if (!probe.detected) {
      addIssue(issues, {
        id: 'nvidia-not-found',
        severity: 'error',
        title: 'No NVIDIA GPU detected',
        detail: `The CUDA variant is selected, but Windows did not report an NVIDIA GPU. The safe fallback is ${recommendedVariant}.`,
        repairable: true,
        action: 'switch-variant',
        data: { targetVariant: recommendedVariant }
      })
    } else {
      evidence.push(`NVIDIA GPU: ${probe.names.join(', ')}`)
      if (probe.totalVramMb && probe.freeVramMb !== null) {
        evidence.push(`NVIDIA VRAM free: ${probe.freeVramMb} / ${probe.totalVramMb} MiB`)
      }
    }

    if (probe.driverVersion) {
      evidence.push(`NVIDIA driver: ${probe.driverVersion}`)
      const hardMinimum = variant.startsWith('cuda-13') ? '580.0' : '528.33'
      const recommendedMinimum = variant.startsWith('cuda-13') ? '580.0' : '551.61'
      if (compareVersions(probe.driverVersion, hardMinimum) < 0) {
        const canDowngrade = variant.startsWith('cuda-13') && recommendedVariant === 'cuda-12.4'
        addIssue(issues, {
          id: 'driver-incompatible',
          severity: 'error',
          title: 'NVIDIA driver is incompatible',
          detail: `Driver ${probe.driverVersion} is below the minimum required by ${variant}.`,
          repairable: canDowngrade,
          action: canDowngrade ? 'switch-variant' : undefined,
          data: canDowngrade ? { targetVariant: 'cuda-12.4' } : { manualDriverUpdate: true }
        })
      } else if (compareVersions(probe.driverVersion, recommendedMinimum) < 0) {
        addIssue(issues, {
          id: 'driver-update-recommended',
          severity: 'warning',
          title: 'NVIDIA driver update recommended',
          detail: `Driver ${probe.driverVersion} may rely on CUDA compatibility mode. ${recommendedMinimum} or newer is recommended for ${variant}.`,
          repairable: false,
          data: { manualDriverUpdate: true }
        })
      }
    } else if (probe.detected) {
      addIssue(issues, {
        id: 'driver-version-unknown',
        severity: 'warning',
        title: 'Unable to read NVIDIA driver version',
        detail: 'nvidia-smi was unavailable, so driver compatibility could not be verified.',
        repairable: false,
        data: { manualDriverUpdate: true }
      })
    }

    if (probe.detected && variant !== recommendedVariant) {
      addIssue(issues, {
        id: 'cuda-variant-mismatch',
        severity: recommendedVariant === 'cuda-13.3' ? 'error' : 'warning',
        title: 'CUDA variant does not match this GPU',
        detail: `${probe.names[0]} is expected to use ${recommendedVariant}, but ${variant} is selected.`,
        repairable: true,
        action: 'switch-variant',
        data: { targetVariant: recommendedVariant }
      })
    }
  }

  if (!binaryPresent) {
    addIssue(issues, {
      id: 'llamacpp-missing',
      severity: 'error',
      title: 'llama.cpp runtime is missing',
      detail: 'llama-server was not found in the configured installation directory.',
      repairable: true,
      action: 'reinstall-llamacpp'
    })
  } else if (variant.startsWith('cuda-') && !cudaBackendPresent) {
    addIssue(issues, {
      id: 'cuda-backend-missing',
      severity: 'error',
      title: 'CUDA backend is incomplete',
      detail: 'ggml-cuda.dll is missing beside llama-server.',
      repairable: true,
      action: 'reinstall-llamacpp'
    })
  } else if ((variant === 'vulkan' || variant === 'rocm') && !acceleratorBackendPresent) {
    const backendName = variant === 'vulkan' ? 'Vulkan' : 'ROCm'
    addIssue(issues, {
      id: 'accelerator-backend-missing',
      severity: 'error',
      title: `${backendName} backend is incomplete`,
      detail: `The ${backendName} backend library is missing beside llama-server.`,
      repairable: true,
      action: 'reinstall-llamacpp'
    })
  }

  if (variant.startsWith('cuda-') && binaryPresent && !cudaRuntimePresent) {
    addIssue(issues, {
      id: 'cuda-runtime-missing',
      severity: 'error',
      title: 'CUDA runtime DLLs are incomplete',
      detail: 'cudart, cuBLAS, or cuBLASLt is missing beside llama-server.',
      repairable: true,
      action: 'repair-runtime'
    })
  }

  let binaryProbeOutput = ''
  if (binary) {
    try {
      binaryProbeOutput = execFileSync(binary, ['--version'], {
        cwd: path.dirname(binary),
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true
      })
    } catch (error: unknown) {
      const details = errorRecord(error)
      binaryProbeOutput = [
        details.stdout?.toString?.() ?? '',
        details.stderr?.toString?.() ?? '',
        details.message ?? ''
      ]
        .filter(Boolean)
        .join('\n')
      const knownCause = issues.some((issue) =>
        [
          'nvidia-not-found',
          'driver-incompatible',
          'cuda-variant-mismatch',
          'cuda-backend-missing',
          'accelerator-backend-missing',
          'cuda-runtime-missing'
        ].includes(issue.id)
      )
      if (!knownCause) {
        addIssue(issues, {
          id: 'llamacpp-probe-failed',
          severity: 'error',
          title: 'llama.cpp runtime could not start',
          detail: binaryProbeOutput.trim().slice(-500) || 'llama-server --version failed.',
          repairable: true,
          action: 'reinstall-llamacpp'
        })
      }
    }
  }

  const runtimeActive =
    ['setting-up', 'starting', 'started'].includes(info.status ?? '') && Boolean(info.pid)
  const startupContext = runtimeActive ? '' : (startupError ?? '')
  const logs = stripAnsi(`${getLlamaCppLog().join('\n')}\n${binaryProbeOutput}\n${startupContext}`)
  const gpuLog = inspectLlamaCppGpuLog(logs)
  const mainModelLog = inspectLlamaCppMainModelLog(logs)
  const mtpLog = inspectLlamaCppMtpLog(logs)
  const multimodalLog = inspectLlamaCppMultimodalLog(logs)
  const cudaDeviceCount = gpuLog.cudaDeviceCount
  const offloadedLayers = gpuLog.offloadedLayers
  const logFailures = classifyLlamaCppLog(logs)
  const processUsage = probeNvidiaProcessUsage(probe, info.pid)
  const processOnGpu = processUsage.active
  const totalUsedVramMb =
    probe.totalVramMb !== null && probe.freeVramMb !== null
      ? Math.max(0, probe.totalVramMb - probe.freeVramMb)
      : null
  const cudaDetectedByRuntime =
    (cudaDeviceCount ?? 0) > 0 || gpuLog.cudaBackendLoaded || gpuLog.cudaDeviceSelected
  const processVramObserved =
    (processUsage.usedMemoryMb ?? 0) > 0 || (processOnGpu === true && (totalUsedVramMb ?? 0) >= 64)
  const gpuAccelerationObserved =
    (offloadedLayers ?? 0) > 0 ||
    (gpuLog.gpuMemoryAllocatedMb ?? 0) > 0 ||
    (variant.startsWith('cuda-') && cudaDetectedByRuntime && processVramObserved)

  if (cudaDeviceCount !== null) evidence.push(`llama.cpp CUDA devices: ${cudaDeviceCount}`)
  if (offloadedLayers !== null) evidence.push(`GPU offloaded layers: ${offloadedLayers}`)
  if (gpuLog.gpuMemoryAllocatedMb !== null) {
    evidence.push(`llama.cpp GPU buffer: ${gpuLog.gpuMemoryAllocatedMb.toFixed(0)} MiB`)
  }
  if (processUsage.usedMemoryMb !== null) {
    evidence.push(`llama-server NVIDIA memory: ${processUsage.usedMemoryMb.toFixed(0)} MiB`)
  }

  if (logFailures.outOfMemory) {
    const memoryKind = variant.startsWith('cuda-')
      ? 'system RAM or NVIDIA VRAM'
      : variant === 'vulkan' || variant === 'rocm'
        ? 'system RAM or GPU memory'
        : process.platform === 'darwin'
          ? 'unified memory'
          : 'system RAM'
    addIssue(issues, {
      id: 'memory-insufficient',
      severity: 'error',
      title: 'Not enough memory to load the model',
      detail: `llama.cpp ran out of ${memoryKind}. Close memory-heavy applications, reduce context size or parallel requests, or select a smaller model.`,
      repairable: false,
      data: { memoryGuidance: true }
    })
  }

  if (
    variant.startsWith('cuda-') &&
    logFailures.backendInitializationFailed &&
    !gpuAccelerationObserved
  ) {
    addIssue(issues, {
      id: 'cuda-initialization-failed',
      severity: 'error',
      title: 'CUDA initialization failed',
      detail: 'llama.cpp reported that the CUDA device or driver could not be initialized.',
      repairable: issues.some(
        (issue) =>
          ['driver-incompatible', 'cuda-runtime-missing', 'cuda-variant-mismatch'].includes(
            issue.id
          ) && issue.repairable
      ),
      action: 'restart'
    })
  } else if (!variant.startsWith('cuda-') && logFailures.backendInitializationFailed) {
    const backendName =
      variant === 'vulkan'
        ? 'Vulkan'
        : variant === 'rocm'
          ? 'ROCm'
          : process.platform === 'darwin'
            ? 'Metal'
            : 'hardware acceleration'
    const canUseCpuFallback = variant === 'vulkan' || variant === 'rocm'
    addIssue(issues, {
      id: 'accelerator-initialization-failed',
      severity: 'error',
      title: `${backendName} initialization failed`,
      detail: canUseCpuFallback
        ? `llama.cpp could not initialize ${backendName}. CPU mode can be used as a compatibility fallback.`
        : `llama.cpp could not initialize ${backendName}. Check the operating system and graphics driver before retrying.`,
      repairable: canUseCpuFallback,
      action: canUseCpuFallback ? 'switch-variant' : undefined,
      data: canUseCpuFallback ? { targetVariant: 'cpu' } : undefined
    })
  }

  const expectsGpuOffload = variant !== 'cpu' || process.platform === 'darwin'
  if (expectsGpuOffload && logFailures.gpuOffloadMissing && !gpuAccelerationObserved) {
    addIssue(issues, {
      id: 'gpu-offload-missing',
      severity: 'error',
      title: 'Model is running without GPU offload',
      detail:
        'The model loaded, but llama.cpp reported that zero layers were offloaded to the GPU.',
      repairable: true,
      action: 'restart'
    })
  }

  if (processOnGpu === true)
    evidence.push('llama-server is registered as an NVIDIA compute process')

  const models = listModels()
  const activeModel = findModelReferencedInLogs(logs, models)
  const referencedOfficialModelName = findOfficialModelNameInLogs(logs)
  const activeModelName = activeModel
    ? path.basename(absoluteModelPath(activeModel))
    : referencedOfficialModelName
  const activeModelPath = activeModel
    ? absoluteModelPath(activeModel)
    : activeModelName
      ? path.join(getModelsDir(), path.basename(activeModelName, '.gguf'), activeModelName)
      : null
  const isDeepDiagnostic = ['manual', 'repair', 'post-repair'].includes(trigger)
  const modelsToCheck = isDeepDiagnostic ? models : activeModel ? [activeModel] : []
  let invalidModels = 0
  const handledPaths = new Set<string>()

  for (const model of modelsToCheck) {
    const filepath = absoluteModelPath(model)
    handledPaths.add(path.normalize(filepath).toLowerCase())
    const currentSize = fs.existsSync(filepath) ? fs.statSync(filepath).size : 0
    const sizeMismatch = model.size > 0 && currentSize !== model.size
    if (!isGgufValid(filepath) || sizeMismatch) {
      invalidModels++
      const source = OFFICIAL_MODEL_SOURCES[path.basename(filepath)]
      addIssue(issues, {
        id: `model-incomplete:${path.basename(filepath)}`,
        severity: 'error',
        title: 'Model file is incomplete',
        detail: `${path.basename(filepath)} failed its GGUF header or file-size check.`,
        repairable: Boolean(source),
        action: source ? 'repair-model' : undefined,
        data: { filepath, source, removeBeforeDownload: true }
      })
    }
  }

  const partialFiles = listPartialGgufFiles(getModelsDir())
  let partialModels = 0
  for (const tmpPath of partialFiles) {
    const finalPath = tmpPath.slice(0, -4)
    const finalName = path.basename(finalPath)
    const lowerFinalName = finalName.toLowerCase()
    if (
      !isDeepDiagnostic &&
      (!activeModelPath ||
        path.normalize(finalPath).toLowerCase() !== path.normalize(activeModelPath).toLowerCase())
    )
      continue
    if (
      lowerFinalName.startsWith('mtp-') ||
      lowerFinalName.includes('mmproj') ||
      handledPaths.has(path.normalize(finalPath).toLowerCase())
    )
      continue
    partialModels++
    const source = OFFICIAL_MODEL_SOURCES[finalName]
    addIssue(issues, {
      id: `model-partial:${finalName}`,
      severity: 'error',
      title: 'Model download is incomplete',
      detail: `${finalName} has a resumable partial download.`,
      repairable: Boolean(source),
      action: source ? 'repair-model' : undefined,
      data: { filepath: finalPath, source, removeBeforeDownload: false }
    })
  }

  let visionProjectorMissing = 0
  const modelsToCheckForVision = isDeepDiagnostic
    ? models
    : multimodalLog.attempted && activeModel
      ? [activeModel]
      : []
  for (const model of modelsToCheckForVision) {
    const filepath = absoluteModelPath(model)
    const modelName = path.basename(filepath)
    const source = MMPROJ_SOURCES[modelName]
    if (!source) continue
    const projectorPath = findCompanionGguf(path.dirname(filepath), source.filename, 'mmproj')
    const partial = hasCompanionPartial(path.dirname(filepath), 'mmproj')
    if (!isGgufValid(projectorPath) || partial) {
      visionProjectorMissing++
      addIssue(issues, {
        id: `mmproj-incomplete:${modelName}`,
        severity: 'warning',
        title: 'Vision projector is incomplete',
        detail: `${source.filename} is missing or incomplete for ${modelName}. Text inference can continue, but image input may fail.`,
        repairable: true,
        action: 'repair-mmproj',
        data: { filepath: projectorPath, source, modelName }
      })
    }
  }

  const multimodalRuntimeFailed =
    logFailures.multimodalLoadFailed ||
    (Boolean(startupError) && !runtimeActive && multimodalLog.inProgress)
  if (multimodalLog.attempted && multimodalRuntimeFailed) {
    const source = activeModelName ? MMPROJ_SOURCES[activeModelName] : undefined
    const filepath =
      source && activeModelPath ? path.join(path.dirname(activeModelPath), source.filename) : ''
    const hasIncompleteProjector = Boolean(
      activeModelName && issues.some((issue) => issue.id === `mmproj-incomplete:${activeModelName}`)
    )
    const repairable =
      !logFailures.outOfMemory && (hasIncompleteProjector || Boolean(source && filepath))
    addIssue(issues, {
      id: `multimodal-load-failed:${activeModelName ?? 'unknown'}`,
      severity: 'error',
      title: 'Multimodal model failed to load',
      detail: logFailures.outOfMemory
        ? 'The vision projector could not load because available memory was exhausted. Use a smaller model or free more memory.'
        : multimodalLog.inProgress && !logFailures.multimodalLoadFailed
          ? 'llama-server exited while the vision projector or image processor was being initialized.'
          : 'llama.cpp rejected the vision projector. The file may be incomplete, incompatible, or paired with the wrong text model.',
      repairable,
      action: repairable ? (hasIncompleteProjector ? 'restart' : 'repair-mmproj') : undefined,
      data:
        source && filepath
          ? { filepath, source, modelName: activeModelName, removeBeforeDownload: true }
          : undefined
    })
  }

  const mtpEnabled = config.llamaCpp?.mtpEnabled === true
  let mtpMissing = 0
  if (mtpEnabled) {
    for (const model of modelsToCheck) {
      const filepath = absoluteModelPath(model)
      const source = MTP_SOURCES[path.basename(filepath)]
      if (!source) continue
      const mtpPath = findCompanionGguf(path.dirname(filepath), source.filename, 'mtp-')
      const partial = hasCompanionPartial(path.dirname(filepath), 'mtp-')
      if (!isGgufValid(mtpPath) || partial) {
        mtpMissing++
        addIssue(issues, {
          id: `mtp-incomplete:${path.basename(filepath)}`,
          severity: 'warning',
          title: 'MTP draft model is incomplete',
          detail: `${source.filename} is missing or incomplete for ${path.basename(filepath)}.`,
          repairable: true,
          action: 'repair-mtp',
          data: { filepath: mtpPath, source, modelName: path.basename(filepath) }
        })
      }
    }

    const mtpRuntimeFailed =
      logFailures.mtpLoadFailed ||
      (Boolean(startupError) && !runtimeActive && mtpLog.inProgress && !multimodalLog.inProgress)
    if (mtpRuntimeFailed) {
      const activeMtpIncomplete = Boolean(
        activeModelName && issues.some((issue) => issue.id === `mtp-incomplete:${activeModelName}`)
      )
      addIssue(issues, {
        id: 'mtp-runtime-error',
        severity: 'error',
        title: 'MTP failed at runtime',
        detail: logFailures.outOfMemory
          ? 'The MTP draft model exhausted available memory. Disabling MTP reduces memory use without removing the main model.'
          : mtpLog.inProgress && !logFailures.mtpLoadFailed
            ? 'llama-server exited while the MTP draft model was being initialized.'
            : 'The MTP draft model failed to load or is not supported by this llama.cpp build. MTP can be disabled without removing the main model.',
        repairable: true,
        action: activeMtpIncomplete ? 'restart' : 'disable-mtp'
      })
    }
  }

  const mainModelRuntimeFailed =
    logFailures.modelLoadFailed ||
    (Boolean(startupError) &&
      !runtimeActive &&
      mainModelLog.inProgress &&
      !mtpLog.inProgress &&
      !multimodalLog.inProgress)
  if (
    mainModelRuntimeFailed &&
    !logFailures.mtpLoadFailed &&
    !multimodalRuntimeFailed &&
    !logFailures.outOfMemory
  ) {
    const source = activeModelName ? OFFICIAL_MODEL_SOURCES[activeModelName] : undefined
    const hasIncompleteModel = Boolean(
      activeModelName &&
      issues.some(
        (issue) =>
          issue.id === `model-incomplete:${activeModelName}` ||
          issue.id === `model-partial:${activeModelName}`
      )
    )
    const shouldUpdateRuntime = logFailures.modelCompatibilityFailed
    const repairable =
      hasIncompleteModel || shouldUpdateRuntime || Boolean(source && activeModelPath)
    addIssue(issues, {
      id: `model-load-failed:${activeModelName ?? 'unknown'}`,
      severity: 'error',
      title: 'Model failed to load',
      detail: shouldUpdateRuntime
        ? 'The model architecture or GGUF feature is not supported by the installed llama.cpp build. Updating the runtime may add support.'
        : mainModelLog.inProgress && !logFailures.modelLoadFailed
          ? 'llama-server exited while the base text model was being initialized.'
          : logFailures.modelFileFailed
            ? 'llama.cpp reported invalid, missing, or corrupted model data.'
            : 'llama.cpp could not load the selected model. The model file may be incompatible or damaged.',
      repairable,
      action: hasIncompleteModel
        ? 'restart'
        : shouldUpdateRuntime
          ? 'reinstall-llamacpp'
          : source && activeModelPath
            ? 'repair-model'
            : undefined,
      data:
        source && activeModelPath
          ? { filepath: activeModelPath, source, removeBeforeDownload: true }
          : undefined
    })
  }

  if (startupError && !runtimeActive && !issues.some((issue) => issue.severity === 'error')) {
    addIssue(issues, {
      id: 'startup-failed',
      severity: 'error',
      title: 'llama.cpp failed to start',
      detail: startupError.slice(-500),
      repairable: true,
      action: 'restart'
    })
  }

  const fingerprintSource = [
    variant,
    info.version ?? '',
    probe.driverVersion ?? '',
    ...issues.map((issue) => issue.id).sort()
  ].join('|')
  const fingerprint = createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 16)

  return {
    checkedAt: new Date().toISOString(),
    trigger,
    healthy: !issues.some((issue) => issue.severity === 'error'),
    fingerprint,
    variant,
    recommendedVariant,
    hardware: {
      nvidiaDetected: probe.detected,
      gpuNames: probe.names.length > 0 ? probe.names : adapterNamesFromProbe(probe),
      driverVersion: probe.driverVersion,
      processOnGpu,
      totalRamBytes,
      freeRamBytes,
      totalVramMb: probe.totalVramMb,
      freeVramMb: probe.freeVramMb
    },
    runtime: {
      status: info.status,
      version: info.version,
      binaryPath: binary,
      binaryPresent,
      acceleratorBackendPresent,
      cudaBackendPresent,
      cudaRuntimePresent,
      cudaDeviceCount,
      offloadedLayers
    },
    models: {
      total: models.length,
      invalid: invalidModels,
      partial: partialModels,
      mtpEnabled,
      mtpMissing,
      visionProjectorMissing
    },
    issues,
    evidence
  }
}

const downloadOfficialModel = async (
  source: OfficialModelSource,
  filepath: string,
  onStatus?: (status: string) => void
): Promise<void> => {
  const modelKey = path.basename(filepath, '.gguf')
  onStatus?.(`Repairing model ${source.saveAs}...`)
  await downloadModel(
    source.repo,
    source.filename,
    (progress) => onStatus?.(`Repairing model ${source.saveAs} ${progress.percent.toFixed(0)}%`),
    undefined,
    source.expectedSize,
    source.saveAs,
    modelKey,
    modelKey
  )
}

export const repairLlamaCpp = async (
  requestedIssueIds: string[] = [],
  onStatus?: (status: string) => void
): Promise<LlamaRepairResult> => {
  const initialReport = await diagnoseLlamaCpp('repair')
  const selected = initialReport.issues.filter(
    (issue) =>
      issue.repairable && (requestedIssueIds.length === 0 || requestedIssueIds.includes(issue.id))
  )
  const actions: string[] = []
  let restartError: string | null = null

  if (selected.length > 0) {
    onStatus?.('Stopping llama.cpp before repair...')
    await stopLlamaCpp()
  }

  const switchIssue = selected.find((issue) => issue.action === 'switch-variant')
  if (switchIssue?.data?.targetVariant) {
    const config = await getConfig()
    const targetVariant = String(switchIssue.data.targetVariant)
    onStatus?.(`Switching llama.cpp to ${targetVariant}...`)
    await setConfig({
      llamaCpp: { ...(config.llamaCpp ?? {}), variant: targetVariant }
    })
    actions.push(`Switched llama.cpp variant to ${targetVariant}`)
  }

  for (const issue of selected.filter((item) => item.action === 'repair-model')) {
    const source = issue.data?.source as OfficialModelSource | undefined
    const filepath = String(issue.data?.filepath ?? '')
    if (!source || !filepath) continue
    if (issue.data?.removeBeforeDownload && fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
    await downloadOfficialModel(source, filepath, onStatus)
    actions.push(`Repaired model ${source.saveAs}`)
  }

  for (const issue of selected.filter((item) => item.action === 'repair-mmproj')) {
    const source = issue.data?.source as CompanionModelSource | undefined
    const filepath = String(issue.data?.filepath ?? '')
    const modelName = String(issue.data?.modelName ?? '')
    if (!source || !filepath || !modelName) continue
    const tmpPath = `${filepath}.tmp`
    if (issue.data?.removeBeforeDownload) {
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } else {
      const validFinal = isGgufValid(filepath)
      if (fs.existsSync(filepath) && !validFinal) fs.unlinkSync(filepath)
      if (validFinal && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    }
    const modelKey = path.basename(modelName, '.gguf')
    const relativeDir = path.relative(getModelsDir(), path.dirname(filepath))
    const subDir =
      relativeDir && relativeDir !== '.' && !relativeDir.startsWith('..') ? relativeDir : undefined
    onStatus?.(`Repairing vision projector for ${modelName}...`)
    await downloadModel(
      source.repo,
      source.filename,
      (progress) => onStatus?.(`Repairing vision projector ${progress.percent.toFixed(0)}%`),
      undefined,
      undefined,
      source.filename,
      modelKey,
      subDir
    )
    actions.push(`Repaired vision projector for ${modelName}`)
  }

  for (const issue of selected.filter((item) => item.action === 'repair-mtp')) {
    const source = issue.data?.source as { repo: string; filename: string } | undefined
    const filepath = String(issue.data?.filepath ?? '')
    const modelName = String(issue.data?.modelName ?? '')
    if (!source || !filepath || !modelName) continue
    const validFinal = isGgufValid(filepath)
    if (fs.existsSync(filepath) && !validFinal) fs.unlinkSync(filepath)
    if (validFinal && fs.existsSync(`${filepath}.tmp`)) fs.unlinkSync(`${filepath}.tmp`)
    const modelKey = path.basename(modelName, '.gguf')
    onStatus?.(`Repairing MTP model ${source.filename}...`)
    await downloadModel(
      source.repo,
      source.filename,
      (progress) =>
        onStatus?.(`Repairing MTP model ${source.filename} ${progress.percent.toFixed(0)}%`),
      undefined,
      undefined,
      source.filename,
      modelKey,
      modelKey
    )
    actions.push(`Repaired MTP model ${source.filename}`)
  }

  if (selected.some((issue) => issue.action === 'disable-mtp')) {
    const config = await getConfig()
    onStatus?.('Disabling incompatible MTP acceleration...')
    await setConfig({
      llamaCpp: { ...(config.llamaCpp ?? {}), mtpEnabled: false }
    })
    actions.push('Disabled MTP acceleration')
  }

  const needsReinstall = selected.some((issue) => issue.action === 'reinstall-llamacpp')
  const needsRuntimeRepair = selected.some((issue) => issue.action === 'repair-runtime')
  if (needsReinstall) {
    await reinstallLlamaCpp(onStatus)
    actions.push('Reinstalled llama.cpp runtime')
  } else if (needsRuntimeRepair || switchIssue) {
    await stopLlamaCpp()
    await setupLlamaCpp(onStatus)
    actions.push(
      needsRuntimeRepair ? 'Repaired CUDA runtime DLLs' : 'Installed matching llama.cpp variant'
    )
  }

  if (selected.length > 0) {
    try {
      onStatus?.('Restarting llama.cpp...')
      await startLlamaCppWithFallback(onStatus)
      const config = await getConfig()
      await setConfig({ llamaCpp: { ...(config.llamaCpp ?? {}), enabled: true } })
      actions.push('Restarted llama.cpp')
    } catch (error: unknown) {
      restartError = errorRecord(error).message ?? String(error)
      log.error('llama.cpp repair restart failed:', error)
    }
  }

  onStatus?.('Checking repair results...')
  const report = await diagnoseLlamaCpp('post-repair', restartError ?? undefined)
  return { actions, restartError, report }
}
