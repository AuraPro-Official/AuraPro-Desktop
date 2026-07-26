const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|secret|token)/i

const redactValue = (value: unknown, key = ''): unknown => {
  if (SENSITIVE_KEY.test(key)) return REDACTED

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey)
      ])
    )
  }

  return value
}

export const redactConfigForLog = (config: unknown): unknown => redactValue(config)
