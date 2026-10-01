import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '../../services/api'
import type { FieldErrors } from './profileDraft'

const SAVED_FLASH_MS = 3000

/** A short-lived "Saved" state after a successful save. */
export function useSavedFlash(): [boolean, () => void] {
  const [isSaved, setIsSaved] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const flash = useCallback(() => {
    window.clearTimeout(timer.current)
    setIsSaved(true)
    timer.current = window.setTimeout(() => setIsSaved(false), SAVED_FLASH_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return [isSaved, flash]
}

export type SaveFailure = { fieldErrors: FieldErrors; message: string }

/**
 * Turns a failed save into field errors (for fields this card owns) plus one
 * card-level message. Drafts are never cleared on failure.
 */
export function describeSaveFailure(error: unknown, fields: readonly string[]): SaveFailure {
  if (error instanceof ApiRequestError) {
    const fieldErrors: FieldErrors = {}

    for (const item of error.errors) {
      if (fields.includes(item.field) && !fieldErrors[item.field]) {
        fieldErrors[item.field] = item.message
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors, message: 'Some fields need attention. Fix them and save again.' }
    }

    if (error.status >= 400 && error.status < 500 && error.status !== 401) {
      return { fieldErrors, message: error.message || 'These changes couldn’t be saved.' }
    }
  }

  return {
    fieldErrors: {},
    message: 'Your changes couldn’t be saved. Check your connection and try again.',
  }
}

/** Moves focus to the first field (in `order`) that has an error. */
export function focusFirstError(errors: FieldErrors, order: readonly string[], idFor: (field: string) => string) {
  const first = order.find((field) => errors[field])

  if (first) {
    document.getElementById(idFor(first))?.focus()
  }
}
