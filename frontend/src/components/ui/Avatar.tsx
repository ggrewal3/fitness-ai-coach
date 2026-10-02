import { useState } from 'react'
import { UserIcon } from './icons'

type AvatarProps = {
  firstName: string
  lastName: string
  /** Browser-ready photo URL; initials (or a person glyph) show without one. */
  imageUrl?: string | null
  className?: string
  onImageError?: () => void
  onImageLoad?: () => void
}

function firstLetter(value: string): string {
  const letter = [...value.trim()][0]
  return letter ? letter.toLocaleUpperCase() : ''
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstLetter(firstName)}${firstLetter(lastName)}`
}

// Decorative: the person's name is always shown as text next to it.
// The initials are always rendered underneath; a photo is only revealed once
// it has loaded, so a failed or slow image never shows a broken-image icon.
function Avatar({ firstName, lastName, imageUrl, className, onImageError, onImageLoad }: AvatarProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const initials = getInitials(firstName, lastName)
  const classes = ['avatar', className].filter(Boolean).join(' ')
  const isVisible = Boolean(imageUrl) && loadedSrc === imageUrl

  return (
    <span className={classes} aria-hidden="true">
      {initials ? <span className="avatar-initials">{initials}</span> : <UserIcon className="avatar-glyph" />}
      {imageUrl && (
        <img
          key={imageUrl}
          className={isVisible ? 'avatar-image loaded' : 'avatar-image'}
          src={imageUrl}
          alt=""
          decoding="async"
          onLoad={() => {
            setLoadedSrc(imageUrl)
            onImageLoad?.()
          }}
          onError={() => {
            setLoadedSrc(null)
            onImageError?.()
          }}
        />
      )}
    </span>
  )
}

export default Avatar
