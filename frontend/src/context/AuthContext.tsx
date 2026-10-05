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
  signInWithAppleIdToken,
  signInWithGoogleCredential,
  type AppleSignInRequest,
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

  // Every sign-in method ends here: only FitAI's own session token is stored
  // (never a provider credential), under the same key as always.
  const acceptSession = useCallback((sessionToken: string) => {
    storeAuthToken(sessionToken)
    setToken(sessionToken)
  }, [])

  const login = useCallback(async (credentials: LoginCredentials) => {
    const response = await loginUser(credentials)

    acceptSession(response.token)
  }, [acceptSession])

  const loginWithGoogle = useCallback(async (credential: string, nonce: string) => {
    const response = await signInWithGoogleCredential(credential, nonce)

    acceptSession(response.token)
    return { isNewUser: response.isNewUser }
  }, [acceptSession])

  const loginWithApple = useCallback(async (appleRequest: AppleSignInRequest) => {
    const response = await signInWithAppleIdToken(appleRequest)

    acceptSession(response.token)
    return { isNewUser: response.isNewUser }
  }, [acceptSession])

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
      loginWithApple,
      loginWithGoogle,
      signup,
      logout,
    }),
    [login, loginWithApple, loginWithGoogle, logout, signup, token],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
