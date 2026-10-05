import { createContext } from "react"
import type {
  AppleSignInRequest,
  AuthUser,
  LoginCredentials,
  SignupCredentials,
} from "../services/api"

export type AuthContextValue = {
  token: string | null
  isAuthenticated: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  /** Exchanges a Google ID token (and its nonce) for a FitAI session; neither is stored. */
  loginWithGoogle: (credential: string, nonce: string) => Promise<{ isNewUser: boolean }>
  /** Exchanges an Apple ID token (and its nonce, plus the first-authorization name) for a FitAI session; none is stored. */
  loginWithApple: (request: AppleSignInRequest) => Promise<{ isNewUser: boolean }>
  signup: (credentials: SignupCredentials) => Promise<AuthUser>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)
