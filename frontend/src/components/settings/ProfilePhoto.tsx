import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { removeProfilePhoto, saveProfilePhoto, type Account } from '../../services/account'
import {
  PHOTO_ACCEPT,
  UnreadableImageError,
  checkPhotoDimensions,
  checkPhotoFile,
  describePhotoRemoveError,
  describePhotoUploadError,
  inspectImage,
  type PhotoDimensions,
} from '../../features/settings/profilePhoto'
import { useAvatarImage } from '../../features/settings/useAvatarImage'
import Avatar from '../ui/Avatar'
import ConfirmDialog from '../ui/ConfirmDialog'
import { AlertIcon, CameraIcon, CheckIcon } from '../ui/icons'
import PhotoPreviewDialog from './PhotoPreviewDialog'

type ProfilePhotoProps = {
  /** Server state, owned by SettingsPage. */
  account: Account
  /** Replaces SettingsPage's account with a server response. */
  onAccountChange: (account: Account) => void
  /** Fetches a freshly signed avatarUrl (merged into SettingsPage's account). */
  onRefreshAvatarUrl: () => Promise<void>
  announce: (message: string) => void
  /** The hero's identity block, rendered between the avatar and the photo actions. */
  children: ReactNode
}

type Selection = { file: File; url: string; dimensions: PhotoDimensions }

const FLASH_MS = 3000

function hasFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files')
}

/**
 * The profile-photo interaction layer of the Settings hero: avatar (with
 * camera badge, hover overlay and drop target), Add/Change/Remove actions,
 * the hidden file input, the preview dialog and the removal confirmation.
 *
 * It owns only transient UI state. The account (and so avatarUrl) stays in
 * SettingsPage; successful uploads/removals hand the server's account back.
 */
function ProfilePhoto({ account, onAccountChange, onRefreshAvatarUrl, announce, children }: ProfilePhotoProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  // Object URL of the current selection; revoked when replaced, cancelled,
  // saved or on unmount (never during render).
  const selectionUrlRef = useRef<string | null>(null)
  const selectAttemptRef = useRef(0)
  const isSavingRef = useRef(false)
  const isRemovingRef = useRef(false)
  const isMountedRef = useRef(false)
  const statusId = useId()

  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [isPreparing, setIsPreparing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const { src, handleError, handleLoad } = useAvatarImage(account.avatarUrl, onRefreshAvatarUrl)
  const hasPhoto = account.avatarUrl !== null
  const isBusy = isPreparing || isSaving || isRemoving

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false

      if (selectionUrlRef.current) {
        URL.revokeObjectURL(selectionUrlRef.current)
        selectionUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!flash) {
      return
    }

    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flash])

  function releaseSelection() {
    if (selectionUrlRef.current) {
      URL.revokeObjectURL(selectionUrlRef.current)
      selectionUrlRef.current = null
    }

    setSelection(null)
    setUploadError(null)
  }

  function openPicker() {
    if (!isBusy) {
      inputRef.current?.click()
    }
  }

  // The single entry point for picked and dropped files.
  async function selectFile(file: File) {
    setFlash(null)
    setRemoveError(null)

    const basicError = checkPhotoFile(file)

    if (basicError) {
      setSelectionError(basicError)
      return
    }

    const attempt = ++selectAttemptRef.current
    const url = URL.createObjectURL(file)
    setIsPreparing(true)

    try {
      const dimensions = await inspectImage(url)
      const dimensionError = checkPhotoDimensions(dimensions)
      const isCurrent = isMountedRef.current && attempt === selectAttemptRef.current

      if (!isCurrent || dimensionError) {
        URL.revokeObjectURL(url)

        if (isCurrent && dimensionError) {
          setSelectionError(dimensionError)
        }

        return
      }

      // A new valid selection replaces (and releases) the previous one.
      if (selectionUrlRef.current) {
        URL.revokeObjectURL(selectionUrlRef.current)
      }

      selectionUrlRef.current = url
      setSelection({ file, url, dimensions })
      setSelectionError(null)
      setUploadError(null)
    } catch (error) {
      URL.revokeObjectURL(url)

      if (isMountedRef.current && attempt === selectAttemptRef.current) {
        setSelectionError(
          error instanceof UnreadableImageError
            ? 'This image couldn’t be opened. Choose another photo.'
            : 'This photo couldn’t be prepared. Try again.',
        )
      }
    } finally {
      if (isMountedRef.current && attempt === selectAttemptRef.current) {
        setIsPreparing(false)
      }
    }
  }

  async function save() {
    if (!selection || isSavingRef.current) {
      return
    }

    isSavingRef.current = true
    setIsSaving(true)
    setUploadError(null)

    try {
      const saved = await saveProfilePhoto(selection.file)

      if (!isMountedRef.current) return

      onAccountChange(saved)
      releaseSelection()
      setSelectionError(null)
      setFlash('Photo updated')
      announce('Profile photo updated.')
    } catch (error) {
      if (!isMountedRef.current) return

      // Keep the selection and its preview so Retry needs no reselection.
      setUploadError(describePhotoUploadError(error))
    } finally {
      isSavingRef.current = false

      if (isMountedRef.current) {
        setIsSaving(false)
      }
    }
  }

  function cancelPreview() {
    if (isSavingRef.current) {
      return
    }

    releaseSelection()
    setSelectionError(null)
  }

  async function removePhoto() {
    setIsConfirmingRemoval(false)

    if (isRemovingRef.current) {
      return
    }

    isRemovingRef.current = true
    setIsRemoving(true)
    setRemoveError(null)
    setFlash(null)

    try {
      const saved = await removeProfilePhoto()

      if (!isMountedRef.current) return

      onAccountChange(saved)
      setFlash('Photo removed')
      announce('Profile photo removed. Your initials are shown instead.')

      // The Remove button (where the confirmation returned focus) is about to
      // unmount; move focus to the photo button so it isn't lost to <body>.
      const active = document.activeElement
      if (!active || active === document.body || active === removeButtonRef.current) {
        primaryButtonRef.current?.focus()
      }
    } catch (error) {
      if (isMountedRef.current) {
        setRemoveError(describePhotoRemoveError(error))
      }
    } finally {
      isRemovingRef.current = false

      if (isMountedRef.current) {
        setIsRemoving(false)
      }
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (isBusy || !hasFiles(event)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragOver(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasFiles(event)) {
      return
    }

    event.preventDefault()
    setIsDragOver(false)

    const file = event.dataTransfer.files[0]

    if (file && !isBusy) {
      void selectFile(file)
    }
  }

  const heroError = selection ? null : (selectionError ?? removeError)
  const zoneClasses = ['profile-photo-zone', isDragOver && 'drag-over', isBusy && 'busy'].filter(Boolean).join(' ')

  return (
    <>
      {/* Pointer/touch shortcut and drop target. Keyboard and assistive tech
          use the visible buttons below, so this is not focusable. */}
      <div
        className={zoneClasses}
        aria-hidden="true"
        onClick={openPicker}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Avatar
          className="settings-hero-avatar"
          firstName={account.firstName}
          lastName={account.lastName}
          imageUrl={src}
          onImageError={handleError}
          onImageLoad={handleLoad}
        />
        <span className="profile-photo-overlay">
          <CameraIcon size={28} />
        </span>
        <span className="profile-photo-badge">
          <CameraIcon size={16} />
        </span>
        {isDragOver && <span className="profile-photo-drop">Drop to preview</span>}
        {(isRemoving || isPreparing) && <span className="photo-busy-ring" />}
      </div>

      {children}

      <div className="profile-photo-actions" aria-busy={isBusy || undefined}>
        <div className="profile-photo-buttons">
          <button
            ref={primaryButtonRef}
            type="button"
            className="dashboard-secondary-button profile-photo-button"
            aria-disabled={isBusy || undefined}
            aria-describedby={statusId}
            onClick={openPicker}
          >
            <CameraIcon size={18} />
            {hasPhoto ? 'Change photo' : 'Add photo'}
          </button>
          {hasPhoto && (
            <button
              ref={removeButtonRef}
              type="button"
              className="profile-photo-remove"
              aria-disabled={isBusy || undefined}
              onClick={() => {
                if (!isBusy) setIsConfirmingRemoval(true)
              }}
            >
              {isRemoving ? 'Removing…' : 'Remove photo'}
            </button>
          )}
        </div>

        <div id={statusId} className="profile-photo-status">
          {isPreparing && <span className="profile-photo-hint">Opening photo…</span>}
          {!isBusy && !heroError && flash && (
            <span className="settings-badge settings-badge-success">
              <CheckIcon size={14} />
              {flash}
            </span>
          )}
          {!isBusy && !heroError && !flash && (
            <span className="profile-photo-hint">JPEG, PNG or WebP, up to 5 MB.</span>
          )}
        </div>

        {heroError && (
          <p className="profile-photo-error" role="alert">
            <AlertIcon size={16} />
            <span>{heroError}</span>
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={PHOTO_ACCEPT}
        tabIndex={-1}
        aria-label="Choose a profile photo"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Reset so choosing the same file again still fires change.
          event.target.value = ''

          if (file) {
            void selectFile(file)
          }
        }}
      />

      {selection && (
        <PhotoPreviewDialog
          file={selection.file}
          previewUrl={selection.url}
          dimensions={selection.dimensions}
          isSaving={isSaving}
          error={uploadError ?? selectionError}
          hasFailed={uploadError !== null}
          onSave={() => void save()}
          onCancel={cancelPreview}
          onChooseAnother={openPicker}
        />
      )}

      {isConfirmingRemoval && (
        <ConfirmDialog
          title="Remove profile photo?"
          message="Your initials will be shown instead. You can add a new photo anytime."
          confirmLabel="Remove photo"
          cancelLabel="Keep photo"
          onConfirm={() => void removePhoto()}
          onCancel={() => setIsConfirmingRemoval(false)}
        />
      )}
    </>
  )
}

export default ProfilePhoto
