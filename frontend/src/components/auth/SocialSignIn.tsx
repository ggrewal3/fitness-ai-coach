import { useRef } from "react"
import { HAS_SOCIAL_SIGN_IN } from "../../features/auth/socialConfig"
import type { SocialSignInError } from "../../features/auth/socialShared"
import AppleSignIn from "./AppleSignIn"
import GoogleSignIn from "./GoogleSignIn"

type SocialSignInProps = {
  mode: "signin" | "signup"
  onBusyChange: (busy: boolean) => void
  onError: (error: SocialSignInError | null) => void
  onSuccess: (result: { isNewUser: boolean }) => void
}

/**
 * The configured provider buttons (Apple first, then Google) and the "or"
 * divider before the password form. Renders nothing when no provider is
 * configured. Only one provider sign-in is verified at a time.
 */
export default function SocialSignIn({ mode, onBusyChange, onError, onSuccess }: SocialSignInProps) {
  const busyRef = useRef(false)

  if (!HAS_SOCIAL_SIGN_IN) return null

  const providerProps = {
    mode,
    onError,
    onSuccess,
    canStart: () => !busyRef.current,
    onBusyChange: (busy: boolean) => {
      busyRef.current = busy
      onBusyChange(busy)
    },
  }

  return (
    <>
      <div className="social-signin-group">
        <AppleSignIn {...providerProps} />
        <GoogleSignIn {...providerProps} />
      </div>
      <p className="auth-divider">
        <span>or</span>
      </p>
    </>
  )
}
