export type KvCacheType = 'q8_0' | 'q4_0' | 'f16'

export const normalizeKvCacheType = (value: unknown): KvCacheType | null =>
  value === 'q8_0' || value === 'q4_0' || value === 'f16' ? value : null
