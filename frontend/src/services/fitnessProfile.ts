import {
  createFitnessProfile,
  getFitnessProfile,
  updateFitnessProfile,
  type ActivityLevel,
  type DietPreference,
  type FitnessGoal,
  type FitnessProfile,
  type FitnessProfileInput,
} from "./api"

export type { ActivityLevel, DietPreference, FitnessGoal, FitnessProfile, FitnessProfileInput }

/** Resolves to null when the user has not created a fitness profile yet. */
export async function fetchFitnessProfile(): Promise<FitnessProfile | null> {
  return getFitnessProfile()
}

/** Creates the profile on first save, then updates it. */
export async function saveFitnessProfile(
  hasProfile: boolean,
  input: FitnessProfileInput,
): Promise<FitnessProfile> {
  return hasProfile ? updateFitnessProfile(input) : createFitnessProfile(input)
}
