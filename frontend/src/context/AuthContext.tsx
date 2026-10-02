import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  clearUserSessionData,
  getStoredAuthToken,
  loginUser,
  registerUser,
  setUnauthorizedHandler,
  storeAuthToken,
  type LoginCredentials,
  type SignupCredentials,
} from "../services/api"
import { AuthContext, type AuthContextValue } from "./auth-context"

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(() =>
    getStoredAuthToken(),
  )

  useEffect(() => {
    // A 401 ends the session: the token and all user-scoped tab storage
    // (e.g. the AI Coach conversation) are cleared.
    const handleUnauthorized = () => {
      clearUserSessionData()
      setToken(null)
    }

    setUnauthorizedHandler(handleUnauthorized)

    return () => {
      setUnauthorizedHandler(null)
    }
  }, [])

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await loginUser(credentials)

    storeAuthToken(response.token)
    setToken(response.token)
  }, [])

  const signup = useCallback(
    async (credentials: SignupCredentials) => registerUser(credentials),
    [],
  )

  const logout = useCallback(() => {
    clearUserSessionData()
    setToken(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isAuthenticated: Boolean(token),
      login,
      signup,
      logout,
    }),
    [login, logout, signup, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
