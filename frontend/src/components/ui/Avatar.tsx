import { UserIcon } from './icons'

type AvatarProps = {
  firstName: string
  lastName: string
  /** Photo URL. Not supported by the backend yet; initials are shown until it is. */
  imageUrl?: string | null
  className?: string
}

function firstLetter(value: string): string {
  const letter = [...value.trim()][0]
  return letter ? letter.toLocaleUpperCase() : ''
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstLetter(firstName)}${firstLetter(lastName)}`
}

// Decorative: the person's name is always shown as text next to it.
function Avatar({ firstName, lastName, imageUrl, className }: AvatarProps) {
  const initials = getInitials(firstName, lastName)
  const classes = ['avatar', className].filter(Boolean).join(' ')

  return (
    <span className={classes} aria-hidden="true">
      {imageUrl ? (
        <img className="avatar-image" src={imageUrl} alt="" />
      ) : initials ? (
        <span className="avatar-initials">{initials}</span>
      ) : (
        <UserIcon className="avatar-glyph" />
      )}
    </span>
  )
}

export default Avatar
