import { useEffect, useState, type FormEvent } from 'react'
import { ApiRequestError } from '../services/api'
import {
  addWeightCheckIn,
  fetchWeightCheckIns,
  getLatestCheckIn,
  removeWeightCheckIn,
  type WeightCheckIn,
} from '../services/checkins'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return error.message
  }

  return fallback
}

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatRecordedAt(recordedAt: string) {
  return new Date(recordedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function ProgressPage() {
  const [checkIns, setCheckIns] = useState<WeightCheckIn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [weightInput, setWeightInput] = useState('')
  const [recordedAtInput, setRecordedAtInput] = useState(() =>
    toDatetimeLocalValue(new Date()),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function loadCheckIns() {
    setIsLoading(true)
    setLoadError(null)

    try {
      const data = await fetchWeightCheckIns()
      setCheckIns(data)
    } catch (error) {
      setLoadError(
        getErrorMessage(error, 'Unable to load weight check-ins.'),
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    async function loadInitialCheckIns() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const data = await fetchWeightCheckIns()
        setCheckIns(data)
      } catch (error) {
        setLoadError(
          getErrorMessage(error, 'Unable to load weight check-ins.'),
        )
      } finally {
        setIsLoading(false)
      }
    }

    void loadInitialCheckIns()
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    const weightKg = Number.parseFloat(weightInput)

    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      setFormError('Enter a valid weight in kg.')
      return
    }

    const recordedAtDate = new Date(recordedAtInput)

    if (Number.isNaN(recordedAtDate.getTime())) {
      setFormError('Enter a valid date and time.')
      return
    }

    setIsSubmitting(true)

    try {
      await addWeightCheckIn({
        weightKg,
        recordedAt: recordedAtDate.toISOString(),
      })

      setWeightInput('')
      setRecordedAtInput(toDatetimeLocalValue(new Date()))
      await loadCheckIns()
    } catch (error) {
      setFormError(getErrorMessage(error, 'Unable to save check-in.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    setDeleteError(null)
    setDeletingId(id)

    try {
      await removeWeightCheckIn(id)
      await loadCheckIns()
    } catch (error) {
      setDeleteError(getErrorMessage(error, 'Unable to delete check-in.'))
    } finally {
      setDeletingId(null)
    }
  }

  const latestCheckIn = getLatestCheckIn(checkIns)

  return (
    <div className="progress-page">
      <h1>Progress</h1>

      <section className="progress-card">
        <h2>Current weight</h2>

        {isLoading && <p>Loading...</p>}

        {!isLoading && loadError && (
          <p className="form-error" role="alert">
            {loadError}
          </p>
        )}

        {!isLoading && !loadError && latestCheckIn && (
          <p className="current-weight">
            {latestCheckIn.weightKg} kg
            <span className="header-label">
              {' '}
              as of {formatRecordedAt(latestCheckIn.recordedAt)}
            </span>
          </p>
        )}

        {!isLoading && !loadError && !latestCheckIn && (
          <p className="header-label">
            No check-ins yet. Add your first weight below.
          </p>
        )}
      </section>

      <section className="progress-card">
        <h2>Add weight check-in</h2>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <form className="checkin-form" onSubmit={handleSubmit}>
          <label>
            Weight (kg)
            <input
              type="number"
              step="0.1"
              min="0"
              value={weightInput}
              onChange={(event) => setWeightInput(event.target.value)}
              required
            />
          </label>

          <label>
            Date & time
            <input
              type="datetime-local"
              value={recordedAtInput}
              onChange={(event) => setRecordedAtInput(event.target.value)}
              required
            />
          </label>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Add check-in'}
          </button>
        </form>
      </section>

      <section className="progress-card">
        <h2>Weight history</h2>

        {deleteError && (
          <p className="form-error" role="alert">
            {deleteError}
          </p>
        )}

        {!isLoading && !loadError && checkIns.length === 0 && (
          <p className="header-label">No weight history yet.</p>
        )}

        {checkIns.length > 0 && (
          <ul className="checkin-list">
            {checkIns.map((checkIn) => (
              <li key={checkIn.id} className="checkin-item">
                <span className="checkin-weight">{checkIn.weightKg} kg</span>
                <span className="header-label">
                  {formatRecordedAt(checkIn.recordedAt)}
                </span>
                <button
                  type="button"
                  className="checkin-delete"
                  onClick={() => void handleDelete(checkIn.id)}
                  disabled={deletingId === checkIn.id}
                >
                  {deletingId === checkIn.id ? 'Deleting...' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default ProgressPage
