<script lang="ts">
  import i18n from '../../../i18n'
  import { getTutorialText, tutorialSections, tutorialUiText } from '../../../tutorials'

  let search = $state('')
  let activeSectionId = $state(tutorialSections[0]?.id ?? '')

  const language = $derived($i18n.language ?? 'zh-CN')
  const normalizedSearch = $derived(search.trim().toLowerCase())
  const localizedSections = $derived(
    (() => {
      return tutorialSections
        .map((section) => {
          const title = getTutorialText(section.title, language)
          const description = getTutorialText(section.description, language)
          const sectionMatches = `${title} ${description}`.toLowerCase().includes(normalizedSearch)
          const items = section.items
            .map((item) => {
              const itemTitle = getTutorialText(item.title, language)
              const summary = getTutorialText(item.summary, language)
              const steps = item.steps.map((step) => getTutorialText(step, language))
              const tips = item.tips?.map((tip) => getTutorialText(tip, language)) ?? []
              const links =
                item.links?.map((link) => ({
                  label: getTutorialText(link.label, language),
                  url: link.url
                })) ?? []
              const searchText =
                `${itemTitle} ${summary} ${steps.join(' ')} ${tips.join(' ')} ${links.map((link) => link.label).join(' ')}`.toLowerCase()

              return {
                id: item.id,
                title: itemTitle,
                summary,
                steps,
                tips,
                links,
                searchText
              }
            })
            .filter(
              (item) =>
                !normalizedSearch || sectionMatches || item.searchText.includes(normalizedSearch)
            )

          return {
            id: section.id,
            title,
            description,
            items
          }
        })
        .filter((section) => section.items.length > 0)
    })()
  )

  const activeSection = $derived(
    localizedSections.find((section) => section.id === activeSectionId) ?? localizedSections[0]
  )

  $effect(() => {
    if (
      localizedSections.length > 0 &&
      !localizedSections.some((section) => section.id === activeSectionId)
    ) {
      activeSectionId = localizedSections[0].id
    }
  })
</script>

<div class="mx-auto max-w-[760px] space-y-4 pb-6">
  <div class="space-y-1">
    <p class="text-[18px] font-semibold tracking-normal text-[#1d1d1f] dark:text-[#fafafa]">
      {$i18n.t('settings.tabs.help')}
    </p>
    <p class="max-w-[640px] text-[12px] leading-5 text-[#1d1d1f]/55 dark:text-[#fafafa]/55">
      {getTutorialText(tutorialUiText.intro, language)}
    </p>
  </div>

  <label class="block">
    <span class="sr-only">{getTutorialText(tutorialUiText.searchPlaceholder, language)}</span>
    <input
      class="h-9 w-full rounded-lg border border-black/[0.08] bg-white/80 px-3 text-[12px] outline-none transition placeholder:text-[#1d1d1f]/35 focus:border-black/[0.18] dark:border-white/[0.1] dark:bg-white/[0.05] dark:placeholder:text-white/30 dark:focus:border-white/[0.22]"
      bind:value={search}
      placeholder={getTutorialText(tutorialUiText.searchPlaceholder, language)}
    />
  </label>

  {#if localizedSections.length === 0}
    <div
      class="rounded-lg border border-black/[0.06] bg-white/60 p-5 text-center text-[12px] text-[#1d1d1f]/55 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-[#fafafa]/55"
    >
      {getTutorialText(tutorialUiText.noResults, language)}
    </div>
  {:else}
    <div class="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
      <div class="space-y-1">
        {#each localizedSections as section (section.id)}
          <button
            type="button"
            class="w-full rounded-lg border border-transparent px-3 py-2 text-left transition {activeSection?.id ===
            section.id
              ? 'bg-black/[0.06] text-[#1d1d1f] dark:bg-white/[0.08] dark:text-[#fafafa]'
              : 'text-[#1d1d1f]/55 hover:bg-black/[0.03] hover:text-[#1d1d1f] dark:text-[#fafafa]/55 dark:hover:bg-white/[0.05] dark:hover:text-[#fafafa]'}"
            onclick={() => (activeSectionId = section.id)}
          >
            <span class="block text-[12px] font-medium">{section.title}</span>
            <span class="mt-0.5 block text-[10px] opacity-60">{section.description}</span>
          </button>
        {/each}
      </div>

      <div class="space-y-3">
        {#if activeSection}
          <div class="space-y-0.5">
            <h2 class="text-[15px] font-semibold tracking-normal">{activeSection.title}</h2>
            <p class="text-[12px] text-[#1d1d1f]/50 dark:text-[#fafafa]/50">
              {activeSection.description}
            </p>
          </div>

          {#each activeSection.items as item (item.id)}
            <article
              class="rounded-lg border border-black/[0.06] bg-white/70 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.035]"
            >
              <div class="space-y-1">
                <h3 class="text-[14px] font-semibold tracking-normal">{item.title}</h3>
                <p class="text-[12px] leading-5 text-[#1d1d1f]/55 dark:text-[#fafafa]/55">
                  {item.summary}
                </p>
              </div>

              <div class="mt-3 space-y-2">
                <p
                  class="text-[11px] font-medium uppercase tracking-[0.04em] text-[#1d1d1f]/40 dark:text-[#fafafa]/40"
                >
                  {getTutorialText(tutorialUiText.stepsLabel, language)}
                </p>
                <ol
                  class="space-y-1.5 pl-4 text-[12px] leading-5 text-[#1d1d1f]/70 dark:text-[#fafafa]/70"
                >
                  {#each item.steps as step, index (index)}
                    <li class="list-decimal">{step}</li>
                  {/each}
                </ol>
              </div>

              {#if item.tips.length > 0}
                <div
                  class="mt-3 rounded-lg border border-black/[0.04] bg-black/[0.025] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.04]"
                >
                  <p class="text-[11px] font-medium text-[#1d1d1f]/45 dark:text-[#fafafa]/45">
                    {getTutorialText(tutorialUiText.tipsLabel, language)}
                  </p>
                  <ul
                    class="mt-1 space-y-1 text-[12px] leading-5 text-[#1d1d1f]/65 dark:text-[#fafafa]/65"
                  >
                    {#each item.tips as tip, index (index)}
                      <li>{tip}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if item.links.length > 0}
                <div class="mt-3 space-y-2">
                  <p
                    class="text-[11px] font-medium uppercase tracking-[0.04em] text-[#1d1d1f]/40 dark:text-[#fafafa]/40"
                  >
                    {getTutorialText(tutorialUiText.linksLabel, language)}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {#each item.links as link (link.url)}
                      <button
                        type="button"
                        class="rounded-lg border border-black/[0.06] bg-black/[0.025] px-2.5 py-1.5 text-[12px] text-[#1d1d1f]/70 transition hover:border-black/[0.12] hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-[#fafafa]/70 dark:hover:border-white/[0.16] dark:hover:bg-white/[0.07]"
                        onclick={() => window.electronAPI.openInBrowser(link.url)}
                      >
                        {link.label}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
