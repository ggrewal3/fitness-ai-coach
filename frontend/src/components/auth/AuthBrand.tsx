import FitAIMark from "../brand/FitAIMark"

/** The FitAI mark and name at the top of the Login and Signup cards. */
export default function AuthBrand() {
  return (
    <div className="auth-brand">
      {/* Decorative: the visible "FitAI" name right next to it names the brand. */}
      <FitAIMark size={72} className="auth-brand-mark" />
      <span className="auth-brand-name">FitAI</span>
    </div>
  )
}
