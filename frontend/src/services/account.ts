import {
  deleteAvatar,
  getAccount,
  resolveMediaUrl,
  updateAccountProfile,
  updateUnitPreferences,
  uploadAvatar,
  type Account,
  type HeightUnit,
  type UnitPreferences,
  type UpdateAccountProfileInput,
  type WeightUnit,
} from "./api"

export type { Account, HeightUnit, UnitPreferences, UpdateAccountProfileInput, WeightUnit }

export async function fetchAccount(): Promise<Account> {
  return getAccount()
}

export async function saveAccountProfile(
  input: UpdateAccountProfileInput,
): Promise<Account> {
  return updateAccountProfile(input)
}

export async function saveUnitPreferences(
  input: Partial<UnitPreferences>,
): Promise<UnitPreferences> {
  return updateUnitPreferences(input)
}

/** Uploads a new profile photo; resolves to the updated account. */
export async function saveProfilePhoto(file: File): Promise<Account> {
  return uploadAvatar(file)
}

/** Removes the profile photo (idempotent); resolves to the updated account. */
export async function removeProfilePhoto(): Promise<Account> {
  return deleteAvatar()
}

export { resolveMediaUrl }
