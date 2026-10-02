import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'

type ModalProps = {
  /** id of the element that names the dialog (usually its heading). */
  labelledBy: string
  /** id of the element that describes the dialog. */
  describedBy?: string
  /** Called on Escape, backdrop click or a close button, unless busy. */
  onClose: () => void
  /** While busy the dialog cannot be dismissed and is marked aria-busy. */
  busy?: boolean
  /** Element to focus when the dialog opens (default: first focusable). */
  initialFocusRef?: RefObject<HTMLElement | null>
  className?: string
  children: ReactNode
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest('[hidden]'))
}

/**
 * Modal dialog shell: role="dialog" + aria-modal, labelled and described,
 * initial focus, Tab kept inside, Escape/backdrop to close, and focus returned
 * to the element that opened it. Render it only while open.
 */
function Modal({ labelledBy, describedBy, onClose, busy = false, initialFocusRef, className, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Initial focus, and focus restoration on close. (Under StrictMode's dev
  // double-mount the restore runs once early, then this re-captures the same
  // opener, so the final close still returns focus correctly.)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const target = initialFocusRef?.current ?? (panel ? focusableWithin(panel)[0] : null) ?? panel
    target?.focus()

    return () => {
      if (opener && opener.isConnected) {
        opener.focus()
      }
    }
    // initialFocusRef is a stable ref object, so this runs once per open.
  }, [initialFocusRef])

  // While busy, controls may become disabled, and a disabled element drops
  // focus to <body>; park focus on the panel instead. When the dialog is no
  // longer busy, hand focus back to the initial target (e.g. "Try again").
  useEffect(() => {
    const panel = panelRef.current
    const active = document.activeElement

    if (!panel) {
      return
    }

    if (busy) {
      if (!panel.contains(active) || (active instanceof HTMLButtonElement && active.disabled)) {
        panel.focus()
      }
    } else if (active === panel) {
      initialFocusRef?.current?.focus()
    }
  }, [busy, initialFocusRef])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()

      if (!busy) {
        onClose()
      }

      return
    }

    if (event.key !== 'Tab' || !panelRef.current) {
      return
    }

    const focusable = focusableWithin(panelRef.current)

    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose()
        }
      }}
    >
      <div
        ref={panelRef}
        className={['modal-panel', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

export default Modal
