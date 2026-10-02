// Client-side session helpers that need no network (and so are unit-testable).

/**
 * Prefix for per-tab browser storage that belongs to the signed-in user.
 * Everything under it is cleared on sign-out (explicit logout or a 401), so a
 * feature can keep user data in sessionStorage without the auth layer knowing
 * about it.
 */
export const USER_SCOPED_STORAGE_PREFIX = "fitai.user."

type KeyedStorage = Pick<Storage, "length" | "key" | "removeItem">

/** Removes every user-scoped key. Never throws (storage may be unavailable). */
export function clearUserScopedStorage(storage: KeyedStorage): void {
  try {
    const keys: string[] = []

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(USER_SCOPED_STORAGE_PREFIX)) keys.push(key)
    }

    for (const key of keys) storage.removeItem(key)
  } catch {
    // Unavailable storage holds nothing to clear.
  }
}

/**
 * The `userId` claim of a JWT, read WITHOUT verifying the signature. Use it
 * only to scope local storage to the signed-in account; the backend remains
 * the authority on identity. Returns null for anything malformed.
 */
export function readJwtUserId(token: string | null): number | null {
  const payload = token?.split(".")[1]

  if (!payload) {
    return null
  }

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")
    const claims: unknown = JSON.parse(atob(base64))
    const userId = (claims as { userId?: unknown } | null)?.userId

    return typeof userId === "number" && Number.isSafeInteger(userId) && userId > 0 ? userId : null
  } catch {
    return null
  }
}
