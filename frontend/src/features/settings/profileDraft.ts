// Editable drafts for the Personal Information and About You cards.
//
// Validation mirrors backend/src/modules/account/account.schemas.ts so most
// mistakes are caught before a request; the backend stays authoritative and
// its field errors are shown as returned.
import type { Account, UpdateAccountProfileInput } from '../../services/account'
import { isSupportedCountryCode } from './countries'

export const NAME_MAX_LENGTH = 50
export const BIO_MAX_LENGTH = 500
export const BIO_WARNING_LENGTH = 450

const E164_PATTERN = /^\+[1-9]\d{7,14}$/
const PHONE_FORMATTING_PATTERN = /[ .()-]/g

export type FieldErrors = Record<string, string>

export type PersonalInfoDraft = {
  firstName: string
  lastName: string
  phone: string
  countryCode: string | null
}

export type PersonalInfoField = keyof PersonalInfoDraft

export function personalInfoFromAccount(account: Account): PersonalInfoDraft {
  return {
    firstName: account.firstName,
    lastName: account.lastName,
    phone: account.phone ?? '',
    countryCode: account.countryCode,
  }
}

/** The phone value the backend would store for this input (null when blank). */
export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(PHONE_FORMATTING_PATTERN, '')
  return compact === '' ? null : compact
}

/** Only the fields that differ from the saved account, in API form. */
export function personalInfoChanges(
  draft: PersonalInfoDraft,
  account: Account,
): UpdateAccountProfileInput {
  const changes: UpdateAccountProfileInput = {}

  if (draft.firstName.trim() !== account.firstName) changes.firstName = draft.firstName.trim()
  if (draft.lastName.trim() !== account.lastName) changes.lastName = draft.lastName.trim()
  if (normalizePhone(draft.phone) !== account.phone) changes.phone = draft.phone.trim() || null
  if (draft.countryCode !== account.countryCode) changes.countryCode = draft.countryCode

  return changes
}

export function validatePersonalInfo(draft: PersonalInfoDraft): FieldErrors {
  const errors: FieldErrors = {}

  for (const field of ['firstName', 'lastName'] as const) {
    const value = draft[field].trim()
    const label = field === 'firstName' ? 'First name' : 'Last name'

    if (!value) errors[field] = `${label} is required.`
    else if (value.length > NAME_MAX_LENGTH) errors[field] = `Use ${NAME_MAX_LENGTH} characters or fewer.`
  }

  const phone = normalizePhone(draft.phone)

  if (phone !== null && !E164_PATTERN.test(phone)) {
    errors.phone = 'Start with + and your country code.'
  }

  if (draft.countryCode !== null && !isSupportedCountryCode(draft.countryCode)) {
    errors.countryCode = 'Choose a country from the list.'
  }

  return errors
}

// C0/C1 control characters other than tab and line feed (the backend rejects them).
function hasDisallowedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    const isC0 = code <= 0x1f && code !== 0x09 && code !== 0x0a
    const isC1 = code >= 0x7f && code <= 0x9f

    if (isC0 || isC1) {
      return true
    }
  }

  return false
}

/** The bio as the backend stores it: CRLF/CR → LF, trimmed. */
export function normalizeBio(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

export function bioLength(value: string): number {
  return normalizeBio(value).length
}

export function bioChanges(draft: string, account: Account): UpdateAccountProfileInput {
  const normalized = normalizeBio(draft)
  const next = normalized === '' ? null : normalized
  return next === account.bio ? {} : { bio: next }
}

export function validateBio(draft: string): string | null {
  const length = bioLength(draft)

  if (length > BIO_MAX_LENGTH) {
    const over = length - BIO_MAX_LENGTH
    return `Bio is ${over} character${over === 1 ? '' : 's'} over the ${BIO_MAX_LENGTH}-character limit.`
  }

  if (hasDisallowedControlCharacter(normalizeBio(draft))) {
    return 'Bio contains characters that can’t be saved.'
  }

  return null
}
