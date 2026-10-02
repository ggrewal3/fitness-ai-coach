// Client-side prechecks and copy for profile photos (ADR-024). These mirror
// backend/src/lib/images/avatarImage.ts for fast feedback only; the backend
// re-validates and re-encodes every upload and stays authoritative.
import { ApiRequestError } from '../../services/api'

export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_MAX_DIMENSION = 8000
export const PHOTO_MAX_PIXELS = 40_000_000

const TYPE_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
}

export type PhotoDimensions = { width: number; height: number }

export function photoTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

/** Binary units, matching the backend's 5 MB (5 × 1024 × 1024 bytes) limit. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`

  const format = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)

  if (bytes < 1024 * 1024) return `${format(bytes / 1024)} KB`
  return `${format(bytes / (1024 * 1024))} MB`
}

/** Type and size checks that need no decoding. Returns an error message or null. */
export function checkPhotoFile(file: File): string | null {
  if (!(file.type in TYPE_LABELS)) {
    return 'Choose a JPEG, PNG or WebP image.'
  }

  if (file.size === 0) {
    return 'This file is empty. Choose another photo.'
  }

  if (file.size > PHOTO_MAX_BYTES) {
    return 'This photo is larger than 5 MB. Choose a smaller one.'
  }

  return null
}

/** Displayed (EXIF-oriented) size limits. Returns an error message or null. */
export function checkPhotoDimensions({ width, height }: PhotoDimensions): string | null {
  if (width > PHOTO_MAX_DIMENSION || height > PHOTO_MAX_DIMENSION || width * height > PHOTO_MAX_PIXELS) {
    return 'This photo is too large. Use one up to 8000 pixels on each side and 40 megapixels.'
  }

  return null
}

export class UnreadableImageError extends Error {}

/**
 * Reads the displayed dimensions from the image header (browsers apply EXIF
 * orientation, so these are the rotated dimensions, as on the server), checks
 * them, and only then fully decodes the image, so oversized "image bombs" are
 * rejected before the expensive decode.
 */
export async function inspectImage(url: string): Promise<PhotoDimensions> {
  const image = new Image()

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new UnreadableImageError())
    image.src = url
  })

  const dimensions = { width: image.naturalWidth, height: image.naturalHeight }

  if (!dimensions.width || !dimensions.height) {
    throw new UnreadableImageError()
  }

  if (!checkPhotoDimensions(dimensions)) {
    try {
      await image.decode()
    } catch {
      throw new UnreadableImageError()
    }
  }

  return dimensions
}

function isNetworkFailure(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status === 0
}

/** Friendly copy for a failed upload (no storage or internal details). */
export function describePhotoUploadError(error: unknown): string {
  if (isNetworkFailure(error)) {
    return 'Couldn’t reach FitAI. Check your connection and try again.'
  }

  const { status, message } = error as ApiRequestError

  if (status === 413) return 'This photo is larger than 5 MB. Choose a smaller one.'
  if (status === 415) return 'Choose a JPEG, PNG or WebP image.'
  if (status === 503) return 'Photos can’t be saved right now. Try again in a moment.'
  // 400 messages from the avatar endpoint are written for users.
  if (status === 400 && message) return message

  return 'Your photo couldn’t be saved. Try again.'
}

export function describePhotoRemoveError(error: unknown): string {
  if (isNetworkFailure(error)) {
    return 'Couldn’t reach FitAI. Check your connection and try again.'
  }

  return 'Your photo couldn’t be removed. Try again.'
}
