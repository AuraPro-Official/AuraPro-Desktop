<script lang="ts">
  let {
    checked,
    label,
    onchange
  }: { checked: boolean; label: string; onchange: (value: boolean) => void } = $props()
</script>

<label class="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-[12px]">
  <span>{label}</span>
  <span class="relative flex h-5 w-9 shrink-0 items-center">
    <input
      type="checkbox"
      role="switch"
      {checked}
      class="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
      onchange={(event) => onchange(event.currentTarget.checked)}
    />
    <span
      aria-hidden="true"
      class="absolute inset-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 {checked
        ? 'bg-emerald-600'
        : 'bg-black/15 dark:bg-white/20'}"
    ></span>
    <span
      aria-hidden="true"
      class="absolute size-4 rounded-full bg-white shadow-sm transition-all {checked
        ? 'left-[18px]'
        : 'left-[2px]'}"
    ></span>
  </span>
</label>
