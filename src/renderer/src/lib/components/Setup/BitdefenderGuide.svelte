<script lang="ts">
  import { fade, fly } from 'svelte/transition'

  let { onClose, onContinue } = $props()

  let currentSlide = $state(0)
  const slideIndexes = [0, 1, 2]
  const totalSlides = slideIndexes.length

  const prev = (): void => {
    if (currentSlide > 0) currentSlide--
  }
  const next = (): void => {
    if (currentSlide < totalSlides - 1) currentSlide++
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-2 backdrop-blur-sm"
  in:fade={{ duration: 200 }}
  out:fade={{ duration: 150 }}
>
  <div
    class="relative max-h-[calc(100vh-1rem)] w-[540px] max-w-full overflow-y-auto rounded-lg bg-[#1a1a1a] shadow-2xl sm:rounded-2xl"
    in:fly={{ y: 16, duration: 250 }}
  >
    <div
      class="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.06] bg-[#1a1a1a] px-6 pb-4 pt-5"
    >
      <div>
        <div class="text-[11px] opacity-35 mb-0.5 text-white">Windows 安装提示</div>
        <h2 class="text-[15px] font-medium text-white">如使用 Bitdefender，请先检查防火墙设置</h2>
      </div>
      <button
        class="text-white/30 hover:text-white/60 transition border-none bg-transparent p-1"
        onclick={onClose}
        aria-label="关闭"
      >
        <svg
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="relative h-[300px] overflow-hidden">
      {#if currentSlide > 0}
        <button
          type="button"
          class="absolute left-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.08] bg-black/30 text-white/40 transition hover:bg-black/50 hover:text-white/75"
          onclick={prev}
          aria-label="上一步"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      {/if}

      {#if currentSlide < totalSlides - 1}
        <button
          type="button"
          class="absolute right-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.08] bg-black/30 text-white/40 transition hover:bg-black/50 hover:text-white/75"
          onclick={next}
          aria-label="下一步"
        >
          <svg
            class="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      {/if}

      {#key currentSlide}
        <div
          class="absolute inset-0 flex flex-col items-center justify-center px-8 gap-5"
          in:fly={{ x: 30, duration: 220 }}
          out:fly={{ x: -30, duration: 180 }}
        >
          {#if currentSlide === 0}
            <div
              class="w-full max-w-[380px] rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-hidden"
            >
              <div class="bg-[#111] px-4 py-3">
                <div class="text-[10px] text-white/35 mb-2 text-center">
                  Windows 任务栏右下角系统托盘
                </div>
                <div
                  class="flex items-center justify-end gap-1.5 bg-[#1e1e1e] rounded-lg px-3 py-2"
                >
                  <div class="flex items-center gap-2 opacity-40">
                    <div class="h-4 w-4 rounded bg-white/20"></div>
                    <div class="h-4 w-4 rounded bg-white/20"></div>
                    <div class="h-4 w-4 rounded bg-white/20"></div>
                  </div>
                  <div class="h-4 w-[1px] bg-white/10 mx-1"></div>
                  <div
                    class="relative flex h-7 w-7 items-center justify-center rounded-md bg-red-600/90 ring-2 ring-red-400 ring-offset-1 ring-offset-[#1e1e1e]"
                  >
                    <svg class="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L4 6v6c0 5.1 3.4 9.9 8 11 4.6-1.1 8-5.9 8-11V6l-8-4z" />
                    </svg>
                    <div class="absolute -bottom-5 left-1/2 -translate-x-1/2">
                      <svg
                        class="h-4 w-4 text-red-400 animate-bounce"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M7 10l5 5 5-5z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
              <div class="px-4 py-3 text-[11px] text-white/55 leading-relaxed text-center">
                双击任务栏右下角的 <span class="text-red-400 font-medium">Bitdefender 红色盾牌</span
                > 图标，打开主界面。
              </div>
            </div>
            <p class="text-[12px] text-white/45 text-center max-w-[340px] leading-relaxed">
              没有安装 Bitdefender 时无需修改任何设置，可以直接开始安装。
            </p>
          {:else if currentSlide === 1}
            <div
              class="w-full max-w-[380px] rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-hidden"
            >
              <div class="flex h-[160px]">
                <div class="w-[118px] bg-[#0d0d0d] flex flex-col pt-3 gap-0.5">
                  <div class="px-3 py-2 text-[10px] text-white/25">仪表盘</div>
                  <div
                    class="mx-2 flex items-center gap-2 rounded-lg bg-red-600/20 border border-red-500/40 px-2 py-2"
                  >
                    <svg
                      class="h-3.5 w-3.5 text-red-400 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                      />
                    </svg>
                    <span class="text-[10px] text-red-300 font-medium">保护</span>
                  </div>
                  <div class="px-3 py-2 text-[10px] text-white/25">隐私</div>
                  <div class="px-3 py-2 text-[10px] text-white/25">实用工具</div>
                </div>
                <div class="flex-1 bg-[#161616] flex items-center justify-center">
                  <div class="text-[10px] text-white/25 text-center">
                    点击左侧“保护”<br />进入保护设置页面
                  </div>
                </div>
              </div>
              <div class="px-4 py-3 text-[11px] text-white/55 leading-relaxed text-center">
                在 Bitdefender 左侧菜单中点击 <span class="text-red-400 font-medium"
                  >保护（Protection）</span
                >。
              </div>
            </div>
          {:else if currentSlide === 2}
            <div
              class="w-full max-w-[380px] rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-hidden"
            >
              <div class="bg-[#0d0d0d] px-4 pt-3 pb-2">
                <div class="text-[10px] text-white/35 mb-2">保护 / 防火墙</div>
                <div
                  class="flex items-center justify-between bg-[#1a1a1a] rounded-lg px-3 py-2.5 mb-2"
                >
                  <div class="flex items-center gap-2">
                    <svg
                      class="h-4 w-4 text-orange-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="1.5"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.047 8.287 8.287 0 009 9.601a8.983 8.983 0 013.361-6.387 8.21 8.21 0 003 2z"
                      />
                    </svg>
                    <div>
                      <div class="text-[11px] text-white/75">防火墙</div>
                      <div class="text-[9px] text-white/35">Firewall</div>
                    </div>
                  </div>
                  <div class="relative flex items-center">
                    <div
                      class="h-5 w-9 rounded-full bg-green-500/80 ring-2 ring-green-400/50 ring-offset-1 ring-offset-[#1a1a1a]"
                    >
                      <div
                        class="absolute top-0.5 left-5 h-4 w-4 rounded-full bg-white shadow-sm"
                      ></div>
                    </div>
                    <div class="absolute -top-5 -right-1">
                      <svg
                        class="h-3.5 w-3.5 text-yellow-400 animate-bounce"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M7 10l5 5 5-5z" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div class="text-[9px] text-white/30 text-center">
                  点击绿色开关，将防火墙暂时关闭。
                </div>
              </div>
              <div class="px-4 py-3 text-[11px] text-white/55 leading-relaxed text-center">
                安装完成后可以重新开启防火墙。这个步骤只是为了避免安装下载被拦截。
              </div>
            </div>
          {/if}
        </div>
      {/key}
    </div>

    <div class="flex items-center justify-center gap-1.5 pb-2">
      {#each slideIndexes as i (i)}
        <button
          type="button"
          class="h-4 border-none bg-transparent p-1"
          onclick={() => {
            currentSlide = i
          }}
          aria-label={`查看步骤 ${i + 1}`}
        >
          <span
            class="block rounded-full transition-all duration-200 {i === currentSlide
              ? 'h-1.5 w-4 bg-red-400'
              : 'h-1.5 w-1.5 bg-white/20'}"
          ></span>
        </button>
      {/each}
    </div>

    <div class="text-center text-[10px] text-white/30 pb-3">
      步骤 {currentSlide + 1} / {totalSlides}
    </div>

    <div
      class="sticky bottom-0 z-20 flex items-center justify-between border-t border-white/[0.06] bg-[#1a1a1a] px-6 py-4"
    >
      <button
        type="button"
        class="rounded-md border border-white/10 bg-transparent px-4 py-2 text-[12px] text-white/50 transition hover:bg-white/[0.05] hover:text-white/80"
        onclick={onClose}
      >
        取消
      </button>

      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border-none bg-white px-5 py-2 text-[12px] font-medium text-black transition hover:bg-gray-100"
        onclick={onContinue}
      >
        我已知晓，开始安装
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </button>
    </div>
  </div>
</div>
