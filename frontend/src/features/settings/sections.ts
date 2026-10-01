// Settings page sections, in page order. `id` is the element id and the URL
// hash used by the section navigation (e.g. /settings#fitness).
export const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'units', label: 'Units' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'connections', label: 'Connections' },
  { id: 'account', label: 'Account' },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value)
}

export function sectionHeadingId(id: SettingsSectionId): string {
  return `settings-${id}-heading`
}
