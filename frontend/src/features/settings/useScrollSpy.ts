import { useEffect, useState } from 'react'

/**
 * The id of the section currently being read: the last section whose top has
 * scrolled past `getOffset()` (the height of any sticky navigation above the
 * content). At the very bottom of the page the last section is active, so short
 * final sections can still become current.
 */
export function useScrollSpy(ids: readonly string[], getOffset: () => number, enabled: boolean): string {
  const [activeId, setActiveId] = useState(ids[0])

  useEffect(() => {
    if (!enabled) {
      return
    }

    let frame = 0

    function update() {
      frame = 0
      const offset = getOffset() + 8
      let current = ids[0]

      for (const id of ids) {
        const element = document.getElementById(id)

        if (element && element.getBoundingClientRect().top - offset <= 0) {
          current = id
        }
      }

      const scrolledToBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2

      if (scrolledToBottom && window.scrollY > 0) {
        current = ids[ids.length - 1]
      }

      setActiveId(current)
    }

    function schedule() {
      if (!frame) {
        frame = window.requestAnimationFrame(update)
      }
    }

    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [ids, getOffset, enabled])

  return activeId
}
