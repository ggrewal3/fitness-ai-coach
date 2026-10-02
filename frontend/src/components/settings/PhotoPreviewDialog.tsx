import { useId, useRef } from 'react'
import { formatFileSize, photoTypeLabel, type PhotoDimensions } from '../../features/settings/profilePhoto'
import Modal from '../ui/Modal'
import { AlertIcon, LockIcon } from '../ui/icons'

type PhotoPreviewDialogProps = {
  file: File
  previewUrl: string
  dimensions: PhotoDimensions
  isSaving: boolean
  /** Upload failure or an invalid replacement pick; shown inline. */
  error: string | null
  /** True after a failed upload, so Save reads "Try again". */
  hasFailed: boolean
  onSave: () => void
  onCancel: () => void
  onChooseAnother: () => void
}

// Confirms a selected photo before upload. The circular preview uses
// object-fit: cover centred, matching the server's EXIF-oriented centre crop.
function PhotoPreviewDialog({
  file,
  previewUrl,
  dimensions,
  isSaving,
  error,
  hasFailed,
  onSave,
  onCancel,
  onChooseAnother,
}: PhotoPreviewDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const saveRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      labelledBy={titleId}
      describedBy={descriptionId}
      onClose={onCancel}
      busy={isSaving}
      initialFocusRef={saveRef}
      className="photo-dialog"
    >
      <h2 id={titleId} className="photo-dialog-title">
        Preview profile photo
      </h2>
      <p id={descriptionId} className="photo-dialog-description">
        This is how your profile photo will appear.
      </p>

      <div className={isSaving ? 'photo-dialog-preview saving' : 'photo-dialog-preview'}>
        <img src={previewUrl} alt="Preview of your new profile photo" />
        {isSaving && <span className="photo-busy-ring" aria-hidden="true" />}
      </div>

      <dl className="photo-dialog-meta">
        <div>
          <dt className="sr-only">File name</dt>
          <dd className="photo-dialog-filename">{file.name}</dd>
        </div>
        <div className="photo-dialog-facts">
          <dt className="sr-only">Type</dt>
          <dd>{photoTypeLabel(file.type)}</dd>
          <dt className="sr-only">Size</dt>
          <dd>{formatFileSize(file.size)}</dd>
          <dt className="sr-only">Dimensions</dt>
          <dd>
            {dimensions.width} × {dimensions.height} px
          </dd>
        </div>
      </dl>

      <p className="photo-dialog-privacy">
        <LockIcon size={16} />
        <span>Your photo is stored privately. Location metadata is removed when you save.</span>
      </p>

      {error && (
        <p className="photo-dialog-error" role="alert">
          <AlertIcon size={18} />
          <span>{error}</span>
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {isSaving ? 'Saving your photo…' : ''}
      </p>

      <div className="photo-dialog-actions">
        <button type="button" className="photo-dialog-choose" onClick={onChooseAnother} disabled={isSaving}>
          Choose another photo
        </button>
        <div className="photo-dialog-buttons">
          <button type="button" className="dashboard-secondary-button" onClick={onCancel} disabled={isSaving}>
            Cancel
          </button>
          <button ref={saveRef} type="button" className="dashboard-primary-button" onClick={onSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : hasFailed ? 'Try again' : 'Save photo'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default PhotoPreviewDialog
