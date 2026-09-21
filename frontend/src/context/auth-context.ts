import { createContext } from "react"
import type {
  AuthUser,
  LoginCredentials,
  SignupCredentials,
} from "../services/api"

export type AuthContextValue = {
  token: string | null
  isAuthenticated: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  signup: (credentials: SignupCredentials) => Promise<AuthUser>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)
