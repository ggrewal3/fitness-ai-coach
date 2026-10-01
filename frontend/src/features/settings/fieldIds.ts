/** The id of a field's helper/error line, for aria-describedby. */
export function fieldMessageId(id: string): string {
  return `${id}-message`
}

/** Stable DOM id for a Settings field, e.g. settings-personal-firstName. */
export function settingsFieldId(card: string, field: string): string {
  return `settings-${card}-${field}`
}
