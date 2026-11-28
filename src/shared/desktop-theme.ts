export type DesktopTheme = 'system' | 'light' | 'dark'

export const normalizeDesktopTheme = (theme: unknown): DesktopTheme =>
  theme === 'light' || theme === 'dark' ? theme : 'system'

export const desktopThemeFromWebUI = (theme: unknown): DesktopTheme | undefined => {
  switch (theme) {
    case 'system':
    case 'light':
    case 'dark':
      return theme
    case 'oled-dark':
      return 'dark'
    case 'her':
      return 'light'
    default:
      return undefined
  }
}
