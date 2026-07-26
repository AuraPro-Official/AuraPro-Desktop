export interface LlamaCppLogFailures {
  outOfMemory: boolean
  modelLoadFailed: boolean
  modelCompatibilityFailed: boolean
  modelFileFailed: boolean
  mtpLoadFailed: boolean
  multimodalLoadFailed: boolean
  backendInitializationFailed: boolean
  gpuOffloadMissing: boolean
}

export interface LlamaCppGpuLogEvidence {
  cudaDeviceCount: number | null
  offloadedLayers: number | null
  zeroOffloadObserved: boolean
  cudaBackendLoaded: boolean
  cudaDeviceSelected: boolean
  gpuMemoryAllocatedMb: number | null
}

export interface LlamaCppComponentLoadState {
  attempted: boolean
  succeeded: boolean
  failed: boolean
  inProgress: boolean
}

const matchesAny = (value: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(value))

const lastMatchIndex = (value: string, patterns: RegExp[]): number => {
  let latest = -1
  for (const pattern of patterns) {
    const flags = `${pattern.flags.replace(/[gy]/g, '')}g`
    const matcher = new RegExp(pattern.source, flags)
    let match: RegExpExecArray | null
    while ((match = matcher.exec(value)) !== null) {
      latest = Math.max(latest, match.index)
      if (match[0].length === 0) matcher.lastIndex++
    }
  }
  return latest
}

const inspectComponentLoad = (
  value: string,
  attemptPatterns: RegExp[],
  successPatterns: RegExp[],
  failurePatterns: RegExp[]
): LlamaCppComponentLoadState => {
  const attemptIndex = lastMatchIndex(value, attemptPatterns)
  const successIndex = lastMatchIndex(value, successPatterns)
  const failureIndex = lastMatchIndex(value, failurePatterns)
  return {
    attempted: Math.max(attemptIndex, successIndex, failureIndex) >= 0,
    succeeded: successIndex >= 0 && successIndex > failureIndex,
    failed: failureIndex >= 0 && failureIndex > successIndex,
    inProgress: attemptIndex >= 0 && attemptIndex > Math.max(successIndex, failureIndex)
  }
}

export const inspectLlamaCppGpuLog = (value: string): LlamaCppGpuLogEvidence => {
  const cudaDeviceCounts = [...value.matchAll(/ggml_cuda_init:\s*found\s+(\d+)\s+CUDA devices?/gi)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter(Number.isFinite)
  const offloadCounts = [
    ...value.matchAll(
      /\boffloaded\s+(\d+)(?:\/\d+)?(?:\s+(?:repeating|repeated))?\s+layers?\s+to\s+(?:GPU|CUDA\d+)/gi
    ),
    ...value.matchAll(
      /\boffloading\s+(\d+)(?:\/\d+)?(?:\s+(?:repeating|repeated))?\s+layers?\s+to\s+(?:GPU|CUDA\d+)/gi
    )
  ]
    .map((match) => Number.parseInt(match[1], 10))
    .filter(Number.isFinite)

  if (/\boffloading\s+(?:the\s+)?output layer\s+to\s+(?:GPU|CUDA\d+)/i.test(value)) {
    offloadCounts.push(1)
  }

  const gpuBufferSizes = [
    ...value.matchAll(
      /\bCUDA\d+\b[^\r\n]{0,120}\bbuffer size\s*=\s*(\d+(?:\.\d+)?)\s*(?:MiB|MB)\b/gi
    ),
    ...value.matchAll(/\btotal VRAM used:\s*(\d+(?:\.\d+)?)\s*(?:MiB|MB)\b/gi)
  ]
    .map((match) => Number.parseFloat(match[1]))
    .filter((size) => Number.isFinite(size) && size > 0)

  return {
    cudaDeviceCount:
      cudaDeviceCounts.length > 0 ? cudaDeviceCounts[cudaDeviceCounts.length - 1] : null,
    offloadedLayers: offloadCounts.length > 0 ? Math.max(...offloadCounts) : null,
    zeroOffloadObserved: offloadCounts.includes(0),
    cudaBackendLoaded: /\bload_backend:\s*loaded CUDA backend\b/i.test(value),
    cudaDeviceSelected: /\b(?:using|assigned to)\s+device\s+CUDA\d+\b/i.test(value),
    gpuMemoryAllocatedMb: gpuBufferSizes.length > 0 ? Math.max(...gpuBufferSizes) : null
  }
}

export const inspectLlamaCppMtpLog = (value: string): LlamaCppComponentLoadState => {
  const attemptPatterns = [
    /\b(?:loading|initializing)\s+(?:the\s+)?(?:draft|mtp) model\b/i,
    /\bcommon_speculative_impl_draft_mtp\b/i
  ]
  const successPatterns = [
    /\bcommon_speculative_impl_draft_mtp:[^\r\n]*(?:adding|initialized|ready)\b/i,
    /\badding speculative implementation\s+['"]draft-mtp['"]/i,
    /\b(?:mtp|draft) model[^\r\n]{0,120}\b(?:loaded|initialized|ready)\b/i
  ]
  const failurePatterns = [
    /\bfailed to load (?:the )?(?:draft|mtp) model\b/i,
    /\b(?:mtp|draft-mtp|speculative)[^\r\n]{0,180}\b(?:error|failed|unsupported|incompatible|mismatch|invalid vector subscript)\b/i,
    /\b(?:error|failed|unsupported|incompatible|mismatch)[^\r\n]{0,180}\b(?:mtp|draft-mtp|speculative)\b/i,
    /\berror loading model:\s*unknown model architecture:\s*['"]?[^'"\r\n]*(?:mtp|assistant)/i
  ]
  return inspectComponentLoad(value, attemptPatterns, successPatterns, failurePatterns)
}

export const inspectLlamaCppMultimodalLog = (value: string): LlamaCppComponentLoadState => {
  const attemptPatterns = [
    /\bmtmd_init_from_file\b/i,
    /\bclip_model_(?:load|loader)\b/i,
    /\b(?:loading|initializing|processing)\s+(?:the\s+)?(?:multimodal model|vision projector|mmproj|image)\b/i
  ]
  const successPatterns = [
    /\bloaded multimodal model\b/i,
    /\bclip_model_load:[^\r\n]*\bloaded meta data\b/i,
    /\bmtmd_init_from_file:[^\r\n]*\b(?:loaded|initialized|ready)\b/i,
    /\bwarmup with image size\s*=/i,
    /\bimage processed in\s+\d+(?:\.\d+)?\s*ms\b/i
  ]
  const failurePatterns = [
    /\bfailed to load (?:the )?(?:multimodal model|vision model|vision projector|mmproj|CLIP model)\b/i,
    /\b(?:mtmd_init_from_file|clip_model_(?:load|loader)|mmproj|multimodal model|vision projector)[^\r\n]{0,220}\b(?:error|failed|unsupported|incompatible|mismatch|invalid)\b/i,
    /\b(?:error|failed|unsupported|incompatible|mismatch|invalid)[^\r\n]{0,220}\b(?:mtmd_init_from_file|clip_model_(?:load|loader)|mmproj|multimodal model|vision projector)\b/i
  ]

  return inspectComponentLoad(value, attemptPatterns, successPatterns, failurePatterns)
}

export const inspectLlamaCppMainModelLog = (value: string): LlamaCppComponentLoadState => {
  const attemptPatterns = [
    /\bsrv\s+load_model:\s*loading model\b/i,
    /\bllama_model_load_from_file_impl:\s*using device\b/i
  ]
  const successPatterns = [
    /\bmain:\s*model loaded\b/i,
    /\bsrv\s+update_slots:\s*all slots are idle\b/i,
    /\bprompt eval time\s*=/i,
    /\bdone request:\s*POST\s+\/v1\/(?:chat\/completions|completions|responses)\b[^\r\n]*\b200\b/i
  ]
  const failurePatterns = [
    /\b(?:failed to load|error loading|unable to load) (?:the )?(?:main |text )?model\b/i,
    /\bllama_model_load_from_file_impl:\s*failed to load model\b/i,
    /\bexiting due to model loading error\b/i
  ]
  return inspectComponentLoad(value, attemptPatterns, successPatterns, failurePatterns)
}

export const classifyLlamaCppLog = (value: string): LlamaCppLogFailures => {
  const outOfMemory = matchesAny(value, [
    /\bout of (?:device |host )?memory\b/i,
    /\b(?:cuda|hip|sycl)?malloc(?:\(\))?\s+failed\b.*\bmemory\b/i,
    /\b(?:failed|unable|cannot|can't)\s+to\s+allocate\b/i,
    /\bfailed to initialize the context:\s*failed to allocate\b/i,
    /\bVK_ERROR_OUT_OF_(?:DEVICE|HOST)_MEMORY\b/i,
    /\bUR_RESULT_ERROR_OUT_OF_(?:DEVICE|HOST)_MEMORY\b/i,
    /\bstd::bad_alloc\b|\bbad allocation\b/i,
    /\bnot enough memory resources\b/i
  ])

  const mtpLoadFailed = inspectLlamaCppMtpLog(value).failed

  const multimodalLoadFailed = inspectLlamaCppMultimodalLog(value).failed

  const modelCompatibilityFailed = matchesAny(value, [
    /\bunknown model architecture\b/i,
    /\bunsupported (?:model|model architecture|architecture|GGUF|quantization|tensor type)\b/i,
    /\bmodel.{0,100}\brequires (?:a )?newer\b/i,
    /\bunknown (?:ggml|GGUF) type\b/i
  ])

  const modelFileFailed = matchesAny(value, [
    /\bfailed to open (?:a )?GGUF\b/i,
    /\binvalid (?:GGUF|magic|model file)\b/i,
    /\bGGUF.{0,100}(?:truncated|corrupt|unexpected end)\b/is,
    /\b(?:tensor|tokenizer|vocab).{0,120}\b(?:not found|missing|failed)\b/is,
    /\bunexpected end of (?:file|stream)\b/i
  ])

  const modelLoadFailed = inspectLlamaCppMainModelLog(value).failed

  const backendInitializationFailed = matchesAny(value, [
    /\bfailed to initialize CUDA\b/i,
    /\bno CUDA-capable device\b/i,
    /\bCUDA driver version is insufficient\b/i,
    /\bunsupported display driver\b/i,
    /\bCUDA error:\s*(?!out of memory)/i,
    /\bfailed to initialize (?:Vulkan|ROCm|HIP|Metal|SYCL)\b/i,
    /\bno (?:Vulkan|ROCm|HIP|Metal|SYCL) (?:device|devices)\b/i,
    /\bVK_ERROR_(?!OUT_OF_(?:DEVICE|HOST)_MEMORY)[A-Z_]+\b/i,
    /\b(?:Vulkan|ROCm|HIP|Metal|SYCL).{0,120}\b(?:initialization|backend).{0,80}\bfailed\b/is
  ])

  const gpuEvidence = inspectLlamaCppGpuLog(value)

  return {
    outOfMemory,
    modelLoadFailed,
    modelCompatibilityFailed,
    modelFileFailed,
    mtpLoadFailed,
    multimodalLoadFailed,
    backendInitializationFailed,
    gpuOffloadMissing:
      gpuEvidence.zeroOffloadObserved &&
      (gpuEvidence.offloadedLayers ?? 0) === 0 &&
      gpuEvidence.gpuMemoryAllocatedMb === null
  }
}

export const hasLlamaCppRuntimeAnomaly = (value: string): boolean =>
  Object.values(classifyLlamaCppLog(value)).some(Boolean)
