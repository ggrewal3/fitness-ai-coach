import { useCallback, useState } from 'react'
import { resolveMediaUrl } from '../../services/account'

/** The stable part of a signed avatar URL (its path), shared by every re-signing. */
function photoIdentity(avatarUrl: string): string {
  return avatarUrl.split('?')[0]
}

/**
 * Display state for a signed avatar URL that may fail (expired link, network
 * error, missing object).
 *
 * On the first failure of a given photo it asks for a fresh signed URL once
 * (`refreshAvatarUrl`); the new URL is then tried once. A second failure leaves
 * the initials in place. The one-refresh budget is tracked per photo identity
 * (URL path), not per URL, so re-signed URLs for the same photo cannot reset it
 * into a loop. A successful load restores the budget, so a link that expires
 * much later can be refreshed again.
 */
export function useAvatarImage(avatarUrl: string | null, refreshAvatarUrl: () => Promise<void>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [refreshedPhoto, setRefreshedPhoto] = useState<string | null>(null)

  const src = avatarUrl && avatarUrl !== failedUrl ? resolveMediaUrl(avatarUrl) : null

  const handleError = useCallback(() => {
    if (!avatarUrl) {
      return
    }

    setFailedUrl(avatarUrl)
    const identity = photoIdentity(avatarUrl)

    if (refreshedPhoto !== identity) {
      setRefreshedPhoto(identity)
      // Retry exactly once after the refresh settles. Signed URLs are stable
      // within a 10-minute window, so the refreshed URL may be identical (e.g.
      // after a transient network error); clearing the failure lets that same
      // URL be tried once more. A second failure lands here with the budget
      // already spent and stays on initials.
      void refreshAvatarUrl().finally(() => setFailedUrl(null))
    }
  }, [avatarUrl, refreshedPhoto, refreshAvatarUrl])

  const handleLoad = useCallback(() => {
    if (avatarUrl && refreshedPhoto === photoIdentity(avatarUrl)) {
      setRefreshedPhoto(null)
    }
  }, [avatarUrl, refreshedPhoto])

  return { src, handleError, handleLoad }
}
