import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'

// Must match the mobile-shell breakpoint in index.css.
const MOBILE_NAV_QUERY = '(max-width: 767px)'

function AppLayout() {
  const [isNavOpen, setIsNavOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasNavOpenRef = useRef(false)

  function closeNav() {
    setIsNavOpen(false)
  }

  // Move focus into the drawer on open and back to the menu button on close.
  useEffect(() => {
    if (isNavOpen) {
      closeButtonRef.current?.focus()
    } else if (wasNavOpenRef.current) {
      menuButtonRef.current?.focus()
    }

    wasNavOpenRef.current = isNavOpen
  }, [isNavOpen])

  // While open: lock page scroll, close on Escape, and close if the viewport
  // grows past the mobile breakpoint so no drawer state leaks into desktop.
  useEffect(() => {
    if (!isNavOpen) {
      return
    }

    const mobileQuery = window.matchMedia(MOBILE_NAV_QUERY)
    const previousOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsNavOpen(false)
      }
    }

    function handleViewportChange(event: MediaQueryListEvent) {
      if (!event.matches) {
        setIsNavOpen(false)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    mobileQuery.addEventListener('change', handleViewportChange)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      mobileQuery.removeEventListener('change', handleViewportChange)
    }
  }, [isNavOpen])

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={isNavOpen}
        onClose={closeNav}
        closeButtonRef={closeButtonRef}
      />

      {isNavOpen && (
        <div className="nav-backdrop" aria-hidden="true" onClick={closeNav} />
      )}

      <div className="main-area" inert={isNavOpen}>
        <Header
          isNavOpen={isNavOpen}
          onOpenNav={() => setIsNavOpen(true)}
          menuButtonRef={menuButtonRef}
        />

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppLayout
