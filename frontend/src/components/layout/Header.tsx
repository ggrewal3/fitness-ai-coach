import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'

function Header() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="header">
      <div>
        <p className="header-label">AI Fitness Coach</p>
        <h1>Welcome back</h1>
      </div>

      <button type="button" onClick={handleLogout}>
        Log out
      </button>
    </header>
  )
}

export default Header
