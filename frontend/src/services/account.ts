import {
  getAccount,
  updateAccountProfile,
  updateUnitPreferences,
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
