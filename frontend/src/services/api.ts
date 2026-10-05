import { clearUserScopedStorage, readJwtUserId } from "../features/auth/userSession"
import { resolveApiUrl } from "./apiUrl"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
)
export const AUTH_TOKEN_STORAGE_KEY = "fitai.auth.token"

type ApiErrorBody = {
  message?: unknown
  errors?: unknown
  code?: unknown
}

export type ApiValidationError = {
  field: string
  message: string
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly errors: ApiValidationError[]
  /** Seconds from the response's Retry-After header (e.g. on 429), if any. */
  readonly retryAfterSeconds: number | null
  /** Machine-readable error code from the body (e.g. "EMAIL_IN_USE"), if any. */
  readonly code: string | null

  constructor(
    message: string,
    status: number,
    errors: ApiValidationError[] = [],
    retryAfterSeconds: number | null = null,
    code: string | null = null,
  ) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.errors = errors
    this.retryAfterSeconds = retryAfterSeconds
    this.code = code
  }
}

/** Retry-After as whole seconds: a delay ("30") or an HTTP date. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = /^\d+$/.test(value.trim()) ? Number(value.trim()) : (Date.parse(value) - Date.now()) / 1000
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null
}

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function getStoredAuthToken(): string | null {
  return sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

export function storeAuthToken(token: string) {
  sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

export function clearStoredAuthToken() {
  sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}

/** Ends the browser side of a session: the token and all user-scoped storage. */
export function clearUserSessionData() {
  clearStoredAuthToken()
  clearUserScopedStorage(sessionStorage)
}

/** The signed-in user's id from the stored token (unverified; for storage scoping only). */
export function getStoredAuthUserId(): number | null {
  try {
    return readJwtUserId(getStoredAuthToken())
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getApiErrorBody(value: unknown): ApiErrorBody {
  return isRecord(value) ? value : {}
}

function getValidationErrors(value: unknown): ApiValidationError[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (item): item is ApiValidationError =>
      isRecord(item) &&
      typeof item.field === "string" &&
      typeof item.message === "string",
  )
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return null
  }

  try {
    return await response.json()
  } catch {
    return null
  }
}

type RequestOptions = RequestInit & {
  /**
   * Whether a 401 means the FitAI session ended (clear the token and sign
   * out). True for every authenticated call. Sign-in endpoints pass false: a
   * 401 there means the credentials or the Google account couldn't be
   * verified, not that an existing session expired.
   */
  endsSessionOn401?: boolean
}

async function request<T>(path: string, { endsSessionOn401 = true, ...options }: RequestOptions = {}): Promise<T> {
  if (!API_BASE_URL) {
    throw new ApiRequestError("API base URL is not configured.", 0)
  }

  const headers = new Headers(options.headers)
  const token = getStoredAuthToken()

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })
  const body = await parseResponseBody(response)

  if (response.status === 401 && endsSessionOn401) {
    clearStoredAuthToken()
    unauthorizedHandler?.()
  }

  if (!response.ok) {
    const errorBody = getApiErrorBody(body)
    const message =
      typeof errorBody.message === "string"
        ? errorBody.message
        : `Backend request failed with status ${response.status}`

    throw new ApiRequestError(
      message,
      response.status,
      getValidationErrors(errorBody.errors),
      parseRetryAfter(response.headers.get("Retry-After")),
      typeof errorBody.code === "string" ? errorBody.code : null,
    )
  }

  return body as T
}

export type HealthResponse = {
  status: string
  message: string
}

export type AuthUser = {
  id: number
  firstName: string
  lastName: string
  email: string
}

export type LoginCredentials = {
  email: string
  password: string
}

export type SignupCredentials = {
  firstName: string
  lastName: string
  email: string
  password: string
}

export type LoginResponse = {
  token: string
  user: AuthUser
}

export type SignupResponse = AuthUser

export async function getBackendHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health")
}

export async function loginUser(
  credentials: LoginCredentials,
): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    endsSessionOn401: false,
  })
}

export async function registerUser(
  credentials: SignupCredentials,
): Promise<SignupResponse> {
  return request<SignupResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
    endsSessionOn401: false,
  })
}

/** Providers FitAI can sign in with. */
export type SocialProvider = "GOOGLE" | "APPLE"

export type SignInNonceResponse = {
  provider: SocialProvider
  nonce: string
  expiresAt: string
}

export type SocialSignInResponse = {
  token: string
  user: AuthUser
  isNewUser: boolean
}

/** A fresh single-use nonce for one provider sign-in (ADR-028). Never stored. */
export async function requestSignInNonce(provider: SocialProvider): Promise<SignInNonceResponse> {
  return request<SignInNonceResponse>("/api/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ provider }),
    endsSessionOn401: false,
  })
}

/**
 * Exchanges Google's ID token (and the nonce it was issued for) for a FitAI
 * session. The credential and nonce are only sent in this request body.
 */
export async function signInWithGoogleCredential(credential: string, nonce: string): Promise<SocialSignInResponse> {
  return request<SocialSignInResponse>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential, nonce }),
    endsSessionOn401: false,
  })
}

export type AppleSignInRequest = {
  idToken: string
  nonce: string
  /** Apple's first-authorization name: unsigned, only names a new account. */
  firstName?: string
  lastName?: string
}

/**
 * Exchanges Apple's ID token (and the nonce it was issued for) for a FitAI
 * session. Never sends Apple's authorization code, email, subject or relay
 * flag: the backend reads those from the signed token.
 */
export async function signInWithAppleIdToken({ idToken, nonce, firstName, lastName }: AppleSignInRequest): Promise<SocialSignInResponse> {
  return request<SocialSignInResponse>("/api/auth/apple", {
    method: "POST",
    body: JSON.stringify({ idToken, nonce, firstName, lastName }),
    endsSessionOn401: false,
  })
}

export type WeightCheckIn = {
  id: number
  userId: number
  weightKg: number
  recordedAt: string
  createdAt: string
  updatedAt: string
}

export type CreateWeightCheckInInput = {
  weightKg: number
  recordedAt: string
}

export async function getWeightCheckIns(): Promise<WeightCheckIn[]> {
  return request<WeightCheckIn[]>("/api/checkins")
}

export async function createWeightCheckIn(
  input: CreateWeightCheckInInput,
): Promise<WeightCheckIn> {
  return request<WeightCheckIn>("/api/checkins", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function deleteWeightCheckIn(id: number): Promise<void> {
  await request<null>(`/api/checkins/${id}`, {
    method: "DELETE",
  })
}

export type MealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK" | "OTHER"

export type NutritionSource = "MANUAL" | "AI_TEXT" | "AI_PHOTO"

export type NutritionFoodItem = {
  id: number
  foodName: string
  quantity: number
  unit: string
  calories: number
  proteinGrams: number
  carbsGrams: number
  fatGrams: number
  mealType: MealType
  source: NutritionSource
  entryDate: string
  recordedAt: string
  createdAt: string
  updatedAt: string
}

export type CreateNutritionFoodItemInput = {
  foodName: string
  quantity: number
  unit: string
  calories: number
  proteinGrams: number
  carbsGrams: number
  fatGrams: number
  mealType: MealType
  source?: NutritionSource
  entryDate: string
  recordedAt: string
}

export type UpdateNutritionFoodItemInput = Partial<CreateNutritionFoodItemInput>

export type DailyNutritionSummary = {
  entryDate: string
  found: boolean
  totalCalories: number
  totalProteinGrams: number
  totalCarbsGrams: number
  totalFatGrams: number
  numberOfFoodItems: number
}

export type NutritionEstimateRequest = {
  foodName: string
  quantity: number
  unit: string
}

export type NutritionEstimateResult = {
  foodName: string
  quantity: number
  unit: string
  calories: number
  proteinGrams: number
  carbsGrams: number
  fatGrams: number
  note: string | null
}

export async function getNutritionFoodItems(): Promise<NutritionFoodItem[]> {
  return request<NutritionFoodItem[]>("/api/nutrition")
}

export async function createNutritionFoodItem(
  input: CreateNutritionFoodItemInput,
): Promise<NutritionFoodItem> {
  return request<NutritionFoodItem>("/api/nutrition", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateNutritionFoodItem(
  id: number,
  input: UpdateNutritionFoodItemInput,
): Promise<NutritionFoodItem> {
  return request<NutritionFoodItem>(`/api/nutrition/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function deleteNutritionFoodItem(id: number): Promise<void> {
  await request<null>(`/api/nutrition/${id}`, {
    method: "DELETE",
  })
}

export async function getDailyNutritionSummary(
  date: string,
): Promise<DailyNutritionSummary> {
  return request<DailyNutritionSummary>(`/api/nutrition/summary/${date}`)
}

export async function estimateNutrition(
  input: NutritionEstimateRequest,
): Promise<NutritionEstimateResult> {
  return request<NutritionEstimateResult>("/api/ai/nutrition/estimate", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

// AI Coach (backend: modules/ai, ADR-025/ADR-026). History is client-held
// text only; sources are derived by the server from successful tool runs.
export type CoachSourceType = "profile" | "weight" | "nutrition" | "activity" | "workouts"

export type CoachSource = {
  type: CoachSourceType
  /** YYYY-MM-DD in the user's calendar; null for the profile. */
  startDate: string | null
  endDate: string | null
}

export type CoachHistoryTurn = {
  role: "user" | "assistant"
  content: string
}

export type CoachRequestBody = {
  message: string
  clientContext: { today: string; timeZone: string }
  history: CoachHistoryTurn[]
}

export type CoachReply = {
  answer: string
  actionItems: string[]
  followUpQuestion: string | null
  sources: CoachSource[]
}

export async function postCoachMessage(body: CoachRequestBody, signal?: AbortSignal): Promise<CoachReply> {
  return request<CoachReply>("/api/ai/coach", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  })
}

export type TrainingType = "STRENGTH" | "CARDIO" | "MOBILITY" | "SPORT" | "OTHER"

export type LoadUnit = "KG" | "LB"

export type Exercise = {
  id: number
  name: string
  isCustom: boolean
}

export type FindOrCreateExerciseResult = {
  exercise: Exercise
  created: boolean
}

export type WorkoutSet = {
  id: number
  position: number
  reps: number
  load: number | null
  loadUnit: LoadUnit | null
}

export type WorkoutExercise = {
  id: number
  position: number
  exercise: Exercise
  sets: WorkoutSet[]
}

type WorkoutSessionFields = {
  id: number
  title: string
  workoutDate: string
  trainingType: TrainingType
  durationMinutes: number
  notes: string | null
  recordedAt: string
}

export type WorkoutDetail = WorkoutSessionFields & {
  exercises: WorkoutExercise[]
}

export type WorkoutSummary = WorkoutSessionFields & {
  exerciseCount: number
  setCount: number
}

export type WorkoutSetInput = {
  reps: number
  load: number | null
  loadUnit: LoadUnit | null
}

export type WorkoutExerciseInput = {
  exerciseId: number
  sets: WorkoutSetInput[]
}

export type CreateWorkoutInput = {
  title: string
  workoutDate: string
  trainingType: TrainingType
  durationMinutes: number
  notes?: string
  recordedAt: string
  exercises: WorkoutExerciseInput[]
}

export type UpdateWorkoutInput = {
  title?: string
  workoutDate?: string
  trainingType?: TrainingType
  durationMinutes?: number
  notes?: string | null
  exercises?: WorkoutExerciseInput[]
}

export type WorkoutListQuery = {
  from?: string
  to?: string
  limit?: number
}

export async function getExercises(
  search: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Exercise[]> {
  const params = new URLSearchParams({ search, limit: String(limit) })

  return request<Exercise[]>(`/api/exercises?${params.toString()}`, { signal })
}

export async function createExercise(
  name: string,
): Promise<FindOrCreateExerciseResult> {
  return request<FindOrCreateExerciseResult>("/api/exercises", {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

export async function getWorkouts(
  query: WorkoutListQuery = {},
): Promise<WorkoutSummary[]> {
  const params = new URLSearchParams()

  if (query.from) params.set("from", query.from)
  if (query.to) params.set("to", query.to)
  if (query.limit !== undefined) params.set("limit", String(query.limit))

  const queryString = params.toString()

  return request<WorkoutSummary[]>(
    `/api/workouts${queryString ? `?${queryString}` : ""}`,
  )
}

export async function getWorkoutsForDate(
  workoutDate: string,
): Promise<WorkoutDetail[]> {
  return request<WorkoutDetail[]>(`/api/workouts/date/${workoutDate}`)
}

export async function getWorkout(id: number): Promise<WorkoutDetail> {
  return request<WorkoutDetail>(`/api/workouts/${id}`)
}

export async function createWorkout(
  input: CreateWorkoutInput,
): Promise<WorkoutDetail> {
  return request<WorkoutDetail>("/api/workouts", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateWorkout(
  id: number,
  input: UpdateWorkoutInput,
): Promise<WorkoutDetail> {
  return request<WorkoutDetail>(`/api/workouts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function deleteWorkout(id: number): Promise<void> {
  await request<null>(`/api/workouts/${id}`, {
    method: "DELETE",
  })
}

// Account and settings (backend: modules/account). The user is always the
// token's user; these endpoints never take a userId.

export type WeightUnit = "KG" | "LB"
export type HeightUnit = "CM" | "FT_IN"

export type UnitPreferences = {
  bodyWeightUnit: WeightUnit
  workoutLoadUnit: WeightUnit
  heightUnit: HeightUnit
}

export type Account = {
  id: number
  firstName: string
  lastName: string
  email: string
  phone: string | null
  countryCode: string | null
  bio: string | null
  /**
   * Signed, expiring read URL of the profile photo, or null (ADR-024). It may
   * be root-relative to the API; display it via resolveMediaUrl().
   */
  avatarUrl: string | null
  createdAt: string
  preferences: UnitPreferences
}

/** Any subset; email is read-only and cannot be sent. */
export type UpdateAccountProfileInput = Partial<{
  firstName: string
  lastName: string
  phone: string | null
  countryCode: string | null
  bio: string | null
}>

export async function getAccount(): Promise<Account> {
  return request<Account>("/api/account")
}

export async function updateAccountProfile(
  input: UpdateAccountProfileInput,
): Promise<Account> {
  return request<Account>("/api/account/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function updateUnitPreferences(
  input: Partial<UnitPreferences>,
): Promise<UnitPreferences> {
  return request<UnitPreferences>("/api/account/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

// Profile photo (ADR-024). The body is the raw image file with its own MIME
// type (request() only adds a JSON Content-Type when none is given).
export async function uploadAvatar(file: File): Promise<Account> {
  return request<Account>("/api/account/avatar", {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  })
}

export async function deleteAvatar(): Promise<Account> {
  return request<Account>("/api/account/avatar", { method: "DELETE" })
}

/** A browser-usable URL for media returned by the API (e.g. avatarUrl). */
export function resolveMediaUrl(url: string): string {
  return resolveApiUrl(API_BASE_URL, url)
}

// Fitness profile (backend: modules/profile). Optional one-to-one: created
// with POST once, then updated with PATCH; null clears a field.

export type FitnessGoal = "LOSE_FAT" | "MAINTAIN" | "GAIN_MUSCLE"
export type ActivityLevel =
  | "SEDENTARY"
  | "LIGHT"
  | "MODERATE"
  | "ACTIVE"
  | "VERY_ACTIVE"
export type DietPreference =
  | "NO_PREFERENCE"
  | "VEGETARIAN"
  | "VEGAN"
  | "PESCATARIAN"
  | "HALAL"

export type FitnessProfile = {
  id: number
  /** UTC-midnight timestamp of the calendar date, or null. */
  dateOfBirth: string | null
  heightCm: number | null
  targetWeightKg: number | null
  goal: FitnessGoal | null
  activityLevel: ActivityLevel | null
  dietPreference: DietPreference | null
  createdAt: string
  updatedAt: string
}

/** medicalNotes exists in the API but is deliberately not used by the UI. */
export type FitnessProfileInput = Partial<{
  dateOfBirth: string | null
  heightCm: number | null
  targetWeightKg: number | null
  goal: FitnessGoal | null
  activityLevel: ActivityLevel | null
  dietPreference: DietPreference | null
}>

type ProfileMeResponse = {
  profile: FitnessProfile | null
}

export async function getFitnessProfile(): Promise<FitnessProfile | null> {
  const response = await request<ProfileMeResponse>("/api/profile/me")
  return response.profile
}

export async function createFitnessProfile(
  input: FitnessProfileInput,
): Promise<FitnessProfile> {
  return request<FitnessProfile>("/api/profile", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateFitnessProfile(
  input: FitnessProfileInput,
): Promise<FitnessProfile> {
  return request<FitnessProfile>("/api/profile/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}
