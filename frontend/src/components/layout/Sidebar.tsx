import type { RefObject } from 'react'
import { NavLink } from 'react-router-dom'
import FitAIMark from '../brand/FitAIMark'

const navigationItems = [
  { label: 'Dashboard', path: '/' },
  { label: 'Progress', path: '/progress' },
  { label: 'Nutrition', path: '/nutrition' },
  { label: 'Workout', path: '/workout' },
  { label: 'AI Coach', path: '/ai-coach' },
  { label: 'Settings', path: '/settings' },
]

type SidebarProps = {
  isOpen: boolean
  onClose: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
}

// On desktop this is the permanent sidebar; below the mobile breakpoint the
// same element becomes the off-canvas navigation drawer (see index.css).
function Sidebar({ isOpen, onClose, closeButtonRef }: SidebarProps) {
  return (
    <aside
      id="app-navigation"
      className={isOpen ? 'sidebar sidebar-open' : 'sidebar'}
    >
      <h2 className="sidebar-brand">
        <FitAIMark size={30} />
        <span>FitAI Coach</span>
      </h2>

      <button
        ref={closeButtonRef}
        type="button"
        className="sidebar-close"
        aria-label="Close navigation menu"
        onClick={onClose}
      >
        &times;
      </button>

      <nav>
        {navigationItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              isActive ? 'nav-link active' : 'nav-link'
            }
            onClick={onClose}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
