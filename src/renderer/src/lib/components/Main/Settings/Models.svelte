<script lang="ts">
  import { onMount } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import i18n from '../../../i18n'

  interface HfModel {
    repo: string
    filename: string
    filepath: string
    size: number
    downloadedAt: string
    sourceRepo?: string
    sourceFilename?: string
  }

  interface HfDownloadEvent {
    type: string
    data?: {
      repo?: string
      filename?: string
      status?: string
      percent?: number
    }
  }

  type ModelCapability = 'image' | 'video' | 'audio'

  interface AuraModel {
    name: string
    sizeStr: string
    repo: string
    hfRepo: string
    filename: string
    mmprojRepo: string
    mmprojFilename: string
    mtpRepo?: string
    mtpFilename?: string
    sizeBytes: number
    ramInfo: string
    macOnly?: boolean
  }

  const AURA_MODELS: AuraModel[] = [
    {
      name: 'lowest.gguf',
      sizeStr: '~3GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-E2B-it-qat-GGUF',
      filename: 'gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-E2B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-E2B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-E2B-it.gguf',
      sizeBytes: 3 * 1024 * 1024 * 1024,
      ramInfo: 'RAM 8G+'
    },
    {
      name: 'low_E4.gguf',
      sizeStr: '~5GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      filename: 'gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-E4B-it.gguf',
      sizeBytes: 5 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 16G+0G / UMA 8G'
    },
    {
      name: 'medium_IQ2.gguf',
      sizeStr: '~11GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      filename: 'gemma-4-26B-A4B-it-UD-Q2_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-26B-A4B-it-GGUF',
      mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
      sizeBytes: 11 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 24G+4G / UMA 18G'
    },
    {
      name: 'medium_Q4.gguf',
      sizeStr: '~7GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-12B-it-qat-GGUF',
      filename: 'gemma-4-12B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-12B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-12B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-12B-it.gguf',
      sizeBytes: 7 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 16G+8G / UMA 10G'
    },
    {
      name: 'high_Q4.gguf',
      sizeStr: '~15GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      filename: 'gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf',
      mmprojRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      mtpRepo: 'unsloth/gemma-4-26B-A4B-it-qat-GGUF',
      mtpFilename: 'mtp-gemma-4-26B-A4B-it.gguf',
      sizeBytes: 15 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 32G+4G / UMA 24G'
    },
    {
      name: 'high-code_IQ4.gguf',
      sizeStr: '~19GB',
      repo: 'AuraPro',
      hfRepo: 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
      filename: 'Qwen3.6-35B-A3B-UD-IQ4_NL.gguf',
      mmprojRepo: 'unsloth/Qwen3.6-35B-A3B-GGUF',
      mmprojFilename: 'mmproj-F16.gguf',
      sizeBytes: 19 * 1024 * 1024 * 1024,
      ramInfo: 'RAM+VRAM 32G+6G / UMA 28G'
    }
  ]

  const AUDIO_CAPABLE_MODELS = new Set(['lowest.gguf', 'low_E4.gguf', 'medium_Q4.gguf'])
  const modelCapabilities = (modelName: string): ModelCapability[] => {
    const capabilities: ModelCapability[] = ['image', 'video']
    if (AUDIO_CAPABLE_MODELS.has(modelName)) capabilities.push('audio')
    return capabilities
  }

  const SOURCE_MIGRATED_MODELS = new Set([
    'lowest.gguf',
    'low_E4.gguf',
    'medium_Q4.gguf',
    'high_Q4.gguf'
  ])

  const platform = $derived(
    (() => {
      const info = navigator.userAgent
      if (info.includes('Mac')) return 'darwin'
      if (info.includes('Win')) return 'win32'
      return 'linux'
    })()
  )
  const visibleAuraModels = () =>
    AURA_MODELS.filter((model) => platform === 'darwin' || !model.macOnly)

  // State
  let models = $state<HfModel[]>([])
  let loaded = $state(false)
  let deleting = $state<string | null>(null)
  let modelsDir = $state('')

  // Download state — track active downloads in the "Downloaded" section
  type ActiveDownload = {
    repo: string
    filename: string
    percent: number
    cancelRepo?: string
    cancelFilename?: string
  }

  const activeDownloads = new SvelteMap<string, ActiveDownload>()

  const dlKey = (repo: string, filename: string): string => `${repo}/${filename}`

  onMount(async () => {
    models = await window.electronAPI.listHfModels()
    modelsDir = (await window.electronAPI.getHfModelsDir()) || ''
    loaded = true

    window.electronAPI.onData((data: HfDownloadEvent) => {
      if (data.type === 'status:huggingface-download') {
        const d = data.data
        if (!d?.repo || !d.filename) return
        const key = dlKey(d.repo, d.filename)
        if (d?.status === 'downloading') {
          const existing = activeDownloads.get(key)
          activeDownloads.set(key, {
            ...existing,
            repo: d.repo,
            filename: d.filename,
            percent: d.percent ?? 0
          })
        }
        if (d?.status === 'done') {
          activeDownloads.delete(key)
          window.electronAPI.listHfModels().then((m: HfModel[]) => {
            models = m
          })
        }
        if (d?.status === 'failed') {
          activeDownloads.delete(key)
        }
      }
    })
  })

  const startDownload = async (
    repo: string,
    originalFilename: string,
    saveAs: string,
    size?: number,
    model?: AuraModel
  ) => {
    const modelKey = saveAs.replace('.gguf', '')
    const displayRepo = modelKey
    const key = dlKey(displayRepo, saveAs)
    activeDownloads.set(key, {
      repo: displayRepo,
      filename: saveAs,
      percent: 0,
      cancelRepo: repo,
      cancelFilename: originalFilename
    })
    const mmprojFilename = 'mmproj-F16.gguf'
    const mmprojKey =
      model?.mmprojRepo && model.mmprojFilename ? dlKey(modelKey, mmprojFilename) : null
    const mtpKey = model?.mtpRepo && model.mtpFilename ? dlKey(modelKey, model.mtpFilename) : null
    if (mmprojKey) {
      activeDownloads.set(mmprojKey, {
        repo: modelKey,
        filename: mmprojFilename,
        percent: 0,
        cancelRepo: model?.mmprojRepo,
        cancelFilename: model?.mmprojFilename
      })
    }
    if (mtpKey && model?.mtpFilename) {
      activeDownloads.set(mtpKey, {
        repo: modelKey,
        filename: model.mtpFilename,
        percent: 0,
        cancelRepo: model?.mtpRepo,
        cancelFilename: model?.mtpFilename
      })
    }
    try {
      const downloads = [
        window.electronAPI.downloadHfModel(
          repo,
          originalFilename,
          undefined,
          size,
          saveAs,
          modelKey,
          modelKey
        )
      ]

      if (model?.mmprojRepo && model.mmprojFilename) {
        downloads.push(
          window.electronAPI.downloadHfModel(
            model.mmprojRepo,
            model.mmprojFilename,
            undefined,
            undefined,
            mmprojFilename,
            modelKey,
            modelKey
          )
        )
      }
      if (model?.mtpRepo && model.mtpFilename) {
        downloads.push(
          window.electronAPI.downloadHfModel(
            model.mtpRepo,
            model.mtpFilename,
            undefined,
            undefined,
            model.mtpFilename,
            modelKey,
            modelKey
          )
        )
      }

      await Promise.all(downloads)
    } catch (e) {
      console.error('Failed to download model:', e)
      activeDownloads.delete(key)
      if (mmprojKey) activeDownloads.delete(mmprojKey)
      if (mtpKey) activeDownloads.delete(mtpKey)
    }
  }

  const cancelAuraModelDownload = async (model: AuraModel) => {
    const modelKey = model.name.replace('.gguf', '')
    await cancelDownload(model.hfRepo, model.filename, modelKey, model.name)
    if (model.mmprojRepo && model.mmprojFilename) {
      await cancelDownload(model.mmprojRepo, model.mmprojFilename, modelKey, 'mmproj-F16.gguf')
    }
    if (model.mtpRepo && model.mtpFilename) {
      await cancelDownload(model.mtpRepo, model.mtpFilename, modelKey, model.mtpFilename)
    }
  }

  const cancelDownload = async (
    repo: string,
    filename: string,
    displayRepo: string = repo,
    displayFilename: string = filename
  ) => {
    try {
      await window.electronAPI.cancelHfDownload(repo, filename)
    } catch (e) {
      console.error('Failed to cancel download:', e)
    }
    activeDownloads.delete(dlKey(displayRepo, displayFilename))
  }

  const removeModel = async (repo: string, filename: string) => {
    deleting = `${repo}/${filename}`
    try {
      await window.electronAPI.deleteHfModel(repo, filename)
      models = await window.electronAPI.listHfModels()
    } catch (e) {
      console.error('Failed to delete model:', e)
    }
    deleting = null
  }

  const isDownloaded = (repo: string, filename: string): boolean => {
    return models.some((m) => m.repo === repo && m.filename === filename)
  }

  const isAuraModelCurrent = (model: AuraModel): boolean => {
    const modelKey = model.name.replace('.gguf', '')
    const installed = models.find((m) => m.repo === modelKey && m.filename === model.name)
    if (!installed) return false
    if (!SOURCE_MIGRATED_MODELS.has(model.name)) return true
    return installed.sourceRepo === model.hfRepo && installed.sourceFilename === model.filename
  }

  const isDownloading = (repo: string, filename: string): boolean => {
    return activeDownloads.has(dlKey(repo, filename))
  }

  const getDownloadPercent = (repo: string, filename: string): number => {
    return activeDownloads.get(dlKey(repo, filename))?.percent ?? 0
  }

  const hasActiveDownloads = $derived(activeDownloads.size > 0)

  const formatSize = (bytes: number): string => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
</script>

{#if !loaded}
  <div class="py-6 text-[12px] opacity-20 text-center">{$i18n.t('common.loading')}</div>
{:else}
  <div class="flex flex-col divide-y divide-white/[0.04]">
    <!-- Models directory -->
    <div class="py-4 flex items-center justify-between gap-4">
      <div class="shrink-0">
        <div class="text-[13px] opacity-70">{$i18n.t('settings.models.modelsDirectory')}</div>
        <div class="text-[11px] opacity-25 mt-0.5">{$i18n.t('settings.models.modelsHint')}</div>
      </div>
      <button
        class="text-[12px] font-mono hover:opacity-80 transition bg-transparent border-none text-[#1d1d1f] dark:text-[#fafafa] p-0 underline decoration-dotted underline-offset-2 cursor-pointer flex items-center gap-1.5 min-w-0 truncate"
        onclick={() => {
          if (modelsDir) window.electronAPI.openPath(modelsDir)
        }}
      >
        <span class="truncate">{modelsDir || '…'}</span>
        <svg
          class="w-3 h-3 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
          />
        </svg>
      </button>
    </div>

    <!-- Downloaded models + active downloads -->
    <div class="py-4">
      <div class="text-[12px] opacity-50 mb-2">{$i18n.t('settings.models.downloadedModels')}</div>

      {#if models.length > 0 || hasActiveDownloads}
        <div class="flex flex-col">
          <!-- Active downloads -->
          {#each [...activeDownloads.values()] as dl (dlKey(dl.repo, dl.filename))}
            <div class="flex items-center gap-3 py-2 group">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-[12px] opacity-60 truncate font-mono">{dl.filename}</span>
                  <span class="text-[10px] opacity-30 font-mono shrink-0"
                    >{dl.percent.toFixed(1)}%</span
                  >
                </div>
                <div
                  class="mt-1.5 w-full h-[3px] bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden"
                >
                  <div
                    class="h-full bg-emerald-400/70 rounded-full transition-[width] duration-300"
                    style="width: {dl.percent}%"
                  ></div>
                </div>
                <div class="text-[10px] opacity-20 mt-1 truncate">{dl.repo}</div>
              </div>
              <button
                class="opacity-0 group-hover:opacity-40 hover:!opacity-70 transition bg-transparent border-none text-[#1d1d1f] dark:text-[#fafafa] p-1 shrink-0"
                onclick={() =>
                  cancelDownload(
                    dl.cancelRepo ?? dl.repo,
                    dl.cancelFilename ?? dl.filename,
                    dl.repo,
                    dl.filename
                  )}
                title={$i18n.t('settings.models.cancelDownload')}
              >
                <svg
                  class="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          {/each}

          <!-- Completed downloads -->
          {#each models as model (`${model.repo}/${model.filename}`)}
            <div class="flex items-center gap-3 py-2 group">
              <div class="min-w-0 flex-1">
                <div class="text-[12px] opacity-60 truncate font-mono">{model.filename}</div>
                <div class="text-[10px] opacity-20 truncate mt-0.5">
                  {model.repo} · {formatSize(model.size)}
                </div>
              </div>
              <button
                class="opacity-0 group-hover:opacity-30 hover:!opacity-60 transition bg-transparent border-none text-[#1d1d1f] dark:text-[#fafafa] p-1 shrink-0 {deleting ===
                `${model.repo}/${model.filename}`
                  ? '!opacity-30 pointer-events-none'
                  : ''}"
                onclick={() => removeModel(model.repo, model.filename)}
                title={$i18n.t('settings.models.deleteModel')}
              >
                {#if deleting === `${model.repo}/${model.filename}`}
                  <div
                    class="w-3 h-3 rounded-full border-[1.5px] border-black/20 dark:border-white/30 border-t-transparent animate-spin"
                  ></div>
                {:else}
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="1.5"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                    />
                  </svg>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="text-[11px] opacity-20 py-3">{$i18n.t('settings.models.noModels')}</div>
      {/if}
    </div>

    <!-- Download from HF -->
    <div class="py-4">
      <div class="text-[12px] opacity-50 mb-2">
        {$i18n.t('settings.models.downloadFromHF')} - AuraPro Models
      </div>

      <div class="flex flex-col mt-2">
        {#each visibleAuraModels() as model (model.filename)}
          {@const modelKey = model.name.replace('.gguf', '')}
          {@const installed = isDownloaded(modelKey, model.name)}
          {@const downloaded = isAuraModelCurrent(model)}
          {@const dlActive = isDownloading(modelKey, model.name)}
          <div class="flex items-center gap-3 py-2 group">
            <div class="min-w-0 flex-1">
              <div class="text-[12px] opacity-50 truncate font-mono">
                {model.name.replace('.gguf', '')}
              </div>
              <div class="text-[10px] opacity-20 mt-0.5">
                {model.sizeStr} · {model.ramInfo}{model.macOnly ? ' · Mac only' : ''}
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                {#each modelCapabilities(model.name) as capability (capability)}
                  <span
                    class="rounded border border-black/[0.06] px-1.5 py-px text-[9px] opacity-30 dark:border-white/[0.08]"
                  >
                    {$i18n.t('settings.models.capability.' + capability)}
                  </span>
                {/each}
              </div>
              {#if dlActive}
                <div
                  class="mt-1.5 w-full h-[3px] bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden"
                >
                  <div
                    class="h-full bg-emerald-400/70 rounded-full transition-[width] duration-300"
                    style="width: {getDownloadPercent(modelKey, model.name)}%"
                  ></div>
                </div>
              {/if}
            </div>
            {#if downloaded}
              <span class="text-[10px] opacity-25 shrink-0"
                >{$i18n.t('settings.models.downloaded')}</span
              >
            {:else if dlActive}
              <div class="flex items-center gap-1.5 shrink-0">
                <span class="text-[10px] opacity-40 font-mono"
                  >{getDownloadPercent(modelKey, model.name).toFixed(0)}%</span
                >
                <button
                  class="opacity-30 hover:opacity-70 transition bg-transparent border-none text-[#1d1d1f] dark:text-[#fafafa] p-0.5"
                  onclick={() => cancelAuraModelDownload(model)}
                  title={$i18n.t('settings.models.cancelDownload')}
                >
                  <svg
                    class="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            {:else}
              <button
                class="{installed
                  ? 'opacity-50'
                  : 'opacity-0 group-hover:opacity-40'} hover:!opacity-70 transition bg-transparent border-none text-[#1d1d1f] dark:text-[#fafafa] p-1 shrink-0"
                onclick={() =>
                  startDownload(model.hfRepo, model.filename, model.name, model.sizeBytes, model)}
                title={installed ? '更新模型' : $i18n.t('common.download')}
              >
                <svg
                  class="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="1.5"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
