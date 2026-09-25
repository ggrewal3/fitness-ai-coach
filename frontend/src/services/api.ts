const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
)
export const AUTH_TOKEN_STORAGE_KEY = "fitai.auth.token"

type ApiErrorBody = {
  message?: unknown
  errors?: unknown
}

export type ApiValidationError = {
  field: string
  message: string
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly errors: ApiValidationError[]

  constructor(
    message: string,
    status: number,
    errors: ApiValidationError[] = [],
  ) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.errors = errors
  }
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

  if (response.status === 401) {
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
  })
}

export async function registerUser(
  credentials: SignupCredentials,
): Promise<SignupResponse> {
  return request<SignupResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
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
