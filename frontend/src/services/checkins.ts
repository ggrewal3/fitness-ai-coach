import {
  createWeightCheckIn,
  deleteWeightCheckIn,
  getWeightCheckIns,
  type CreateWeightCheckInInput,
  type WeightCheckIn,
} from "./api"

export type { WeightCheckIn, CreateWeightCheckInInput }

export async function fetchWeightCheckIns(): Promise<WeightCheckIn[]> {
  return getWeightCheckIns()
}

export async function addWeightCheckIn(
  input: CreateWeightCheckInInput,
): Promise<WeightCheckIn> {
  return createWeightCheckIn(input)
}

export async function removeWeightCheckIn(id: number): Promise<void> {
  await deleteWeightCheckIn(id)
}

// Backend returns check-ins ordered by recordedAt desc, so the first entry is the latest.
export function getLatestCheckIn(
  checkIns: WeightCheckIn[],
): WeightCheckIn | null {
  return checkIns[0] ?? null
}
