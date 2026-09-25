import {
  createNutritionFoodItem,
  deleteNutritionFoodItem,
  estimateNutrition,
  getDailyNutritionSummary,
  getNutritionFoodItems,
  updateNutritionFoodItem,
  type CreateNutritionFoodItemInput,
  type DailyNutritionSummary,
  type MealType,
  type NutritionEstimateRequest,
  type NutritionEstimateResult,
  type NutritionFoodItem,
  type NutritionSource,
  type UpdateNutritionFoodItemInput,
} from "./api"

export type {
  CreateNutritionFoodItemInput,
  DailyNutritionSummary,
  MealType,
  NutritionEstimateRequest,
  NutritionEstimateResult,
  NutritionFoodItem,
  NutritionSource,
  UpdateNutritionFoodItemInput,
}

export async function fetchFoodItems(): Promise<NutritionFoodItem[]> {
  return getNutritionFoodItems()
}

export async function fetchDailySummary(
  entryDate: string,
): Promise<DailyNutritionSummary> {
  return getDailyNutritionSummary(entryDate)
}

export async function addFoodItem(
  input: CreateNutritionFoodItemInput,
): Promise<NutritionFoodItem> {
  return createNutritionFoodItem(input)
}

export async function editFoodItem(
  id: number,
  input: UpdateNutritionFoodItemInput,
): Promise<NutritionFoodItem> {
  return updateNutritionFoodItem(id, input)
}

export async function removeFoodItem(id: number): Promise<void> {
  await deleteNutritionFoodItem(id)
}

// Read/compute only - never persists. The caller must POST through
// addFoodItem separately once the user confirms the estimate.
export async function getNutritionEstimate(
  input: NutritionEstimateRequest,
): Promise<NutritionEstimateResult> {
  return estimateNutrition(input)
}

// The backend's entryDate is the authoritative logical nutrition day; reading
// its "YYYY-MM-DD" prefix here (rather than reformatting it through a Date)
// keeps the frontend's notion of "which day this item belongs to" identical
// to the backend's, regardless of browser timezone.
export function getEntryDateString(item: NutritionFoodItem): string {
  return item.entryDate.slice(0, 10)
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

// The user's local calendar date - what "today" means to them when logging
// nutrition, independent of how the backend stores/interprets dates.
export function getLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Adds/subtracts whole days to a "YYYY-MM-DD" string using UTC-anchored
// arithmetic only, so the result never drifts across a browser-timezone
// boundary (no local Date parsing/formatting is involved at any point).
export function shiftDateString(dateString: string, deltaDays: number): string {
  const [year, month, day] = dateString.split("-").map(Number)
  const shiftedMs =
    Date.UTC(year, month - 1, day) + deltaDays * 24 * 60 * 60 * 1000
  const shifted = new Date(shiftedMs)

  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`
}

export function formatDateLabel(dateString: string): string {
  return new Date(`${dateString}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

export function guessMealTypeByTimeOfDay(date: Date = new Date()): MealType {
  const hour = date.getHours()

  if (hour < 11) return "BREAKFAST"
  if (hour < 15) return "LUNCH"
  if (hour < 20) return "DINNER"

  return "SNACK"
}

export const MEAL_TYPE_ORDER: MealType[] = [
  "BREAKFAST",
  "LUNCH",
  "DINNER",
  "SNACK",
  "OTHER",
]

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  SNACK: "Snacks",
  OTHER: "Other",
}

// MANUAL is deliberately omitted - it is the implicit default and stays
// unlabeled in the UI so provenance only surfaces when it is informative.
export const SOURCE_LABELS: Partial<Record<NutritionSource, string>> = {
  AI_TEXT: "AI estimated",
  AI_PHOTO: "Photo estimate",
}
