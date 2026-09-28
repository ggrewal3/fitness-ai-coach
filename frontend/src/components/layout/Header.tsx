import type { RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import FitAIMark from '../brand/FitAIMark'

type HeaderProps = {
  isNavOpen: boolean
  onOpenNav: () => void
  menuButtonRef: RefObject<HTMLButtonElement | null>
}

function Header({ isNavOpen, onOpenNav, menuButtonRef }: HeaderProps) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="header">
      <button
        ref={menuButtonRef}
        type="button"
        className="header-menu-button"
        aria-label="Open navigation menu"
        aria-expanded={isNavOpen}
        aria-controls="app-navigation"
        onClick={onOpenNav}
      >
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="header-mobile-brand">
        <FitAIMark size={28} />
        <span>FitAI Coach</span>
      </div>

      <div className="header-title">
        <p className="header-label">AI Fitness Coach</p>
        <h1>Welcome back</h1>
      </div>

      <button type="button" className="header-logout" onClick={handleLogout}>
        Log out
      </button>
    </header>
  )
}

export default Header
