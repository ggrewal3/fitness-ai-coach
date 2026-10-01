import { useEffect } from 'react'
import { useBlocker, type Blocker } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'

/**
 * Protects unsaved edits from being silently discarded.
 *
 * - In-app navigation that changes the path or query (links, sidebar/drawer,
 *   browser Back) is blocked; render a confirmation while
 *   `blocker.state === 'blocked'` and call `proceed()` / `reset()`.
 *   Hash-only changes (in-page section links) are never blocked.
 * - Reloading or closing the tab gets the browser's own prompt.
 *
 * React Router supports one active blocker at a time, so a page should call
 * this once with its combined dirty state.
 *
 * Once the session has ended (logout, expired token) there is nothing left to
 * save, so the guard never blocks and releases any navigation it was holding;
 * the user is never trapped behind a dialog on a logged-out page.
 */
export function useUnsavedChangesGuard(isDirty: boolean): Blocker {
  const { isAuthenticated } = useAuth()
  const shouldGuard = isDirty && isAuthenticated

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      shouldGuard &&
      `${currentLocation.pathname}${currentLocation.search}` !==
        `${nextLocation.pathname}${nextLocation.search}`,
  )

  useEffect(() => {
    if (blocker.state === 'blocked' && !isAuthenticated) {
      blocker.proceed()
    }
  }, [blocker, isAuthenticated])

  useEffect(() => {
    if (!shouldGuard) {
      return
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [shouldGuard])

  return blocker
}
