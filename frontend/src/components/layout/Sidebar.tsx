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

function Sidebar() {
  return (
    <aside className="sidebar">
      <h2 className="sidebar-brand">
        <FitAIMark size={30} />
        <span>FitAI Coach</span>
      </h2>

      <nav>
        {navigationItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              isActive ? 'nav-link active' : 'nav-link'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar