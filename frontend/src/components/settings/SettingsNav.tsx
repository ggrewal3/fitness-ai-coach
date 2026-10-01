import { useEffect, useRef, type MouseEvent, type RefObject } from 'react'
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../../features/settings/sections'

type SettingsNavProps = {
  navRef: RefObject<HTMLElement | null>
  activeId: SettingsSectionId
  dirtySections: ReadonlySet<SettingsSectionId>
  onNavigate: (id: SettingsSectionId) => void
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// In-page section navigation: a sticky side list on wide screens and a sticky,
// horizontally scrollable chip row on narrow ones (same links, CSS layout only).
// Plain links, not ARIA tabs: every section stays in the page.
function SettingsNav({ navRef, activeId, dirtySections, onNavigate }: SettingsNavProps) {
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the active chip visible inside the horizontal scroller.
  useEffect(() => {
    const list = listRef.current
    const link = list?.querySelector<HTMLAnchorElement>(`a[data-section="${activeId}"]`)

    if (!list || !link || list.scrollWidth <= list.clientWidth) {
      return
    }

    const linkStart = link.offsetLeft
    const linkEnd = linkStart + link.offsetWidth
    const viewStart = list.scrollLeft
    const viewEnd = viewStart + list.clientWidth

    if (linkStart < viewStart + 16 || linkEnd > viewEnd - 16) {
      list.scrollTo({
        left: Math.max(0, linkStart - 24),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
    }
  }, [activeId])

  function handleClick(event: MouseEvent<HTMLAnchorElement>, id: SettingsSectionId) {
    event.preventDefault()
    onNavigate(id)
  }

  return (
    <nav ref={navRef} className="settings-nav" aria-label="Settings sections">
      <ul ref={listRef} className="settings-nav-list">
        {SETTINGS_SECTIONS.map((section) => {
          const isActive = section.id === activeId
          const isDirty = dirtySections.has(section.id)

          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                data-section={section.id}
                className={isActive ? 'settings-nav-link active' : 'settings-nav-link'}
                aria-current={isActive ? 'location' : undefined}
                onClick={(event) => handleClick(event, section.id)}
              >
                {section.label}
                {isDirty && (
                  <>
                    <span className="settings-nav-dot" aria-hidden="true" />
                    <span className="sr-only"> (unsaved changes)</span>
                  </>
                )}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default SettingsNav
