export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

export const getErrorName = (error: unknown): string => (error instanceof Error ? error.name : '')
