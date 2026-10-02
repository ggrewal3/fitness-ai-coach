import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import WorkoutEditor from '../components/workout/WorkoutEditor'
import { useUnitPreferences } from '../context/useUnitPreferences'
import { ApiRequestError } from '../services/api'
import { getLocalDateString } from '../services/nutrition'
import {
  addWorkout,
  editWorkout,
  fetchWorkout,
  type LoadUnit,
  type WorkoutDetail,
} from '../services/workouts'
import {
  createEmptyDraft,
  draftFromWorkout,
  draftToCreateInput,
  draftToUpdateInput,
  isValidDateString,
} from '../features/workout/workoutDraft'

function LoadingView({ label }: { label: string }) {
  return (
    <div className="workout-editor-page">
      <p className="nutrition-summary-status">{label}</p>
    </div>
  )
}

function CreateWorkoutView() {
  const [searchParams] = useSearchParams()
  const dateParam = searchParams.get('date')
  const [workoutDate] = useState(() =>
    dateParam && isValidDateString(dateParam) ? dateParam : getLocalDateString(new Date()),
  )
  const { preferences, isLoading } = useUnitPreferences()

  // The initial draft captures the preferred load unit, so wait for it.
  if (isLoading) {
    return <LoadingView label="Loading…" />
  }

  return <CreateWorkoutEditor workoutDate={workoutDate} loadUnit={preferences.workoutLoadUnit} />
}

function CreateWorkoutEditor({ workoutDate, loadUnit }: { workoutDate: string; loadUnit: LoadUnit }) {
  // Built once: later preference changes never alter an open editor.
  const [initialDraft] = useState(() => createEmptyDraft(workoutDate, loadUnit))

  return (
    <div className="workout-editor-page">
      <WorkoutEditor
        mode="create"
        initialDraft={initialDraft}
        returnTo={`/workout?date=${workoutDate}`}
        // recordedAt is the moment the workout is logged; it is never edited.
        onSave={(draft) => addWorkout(draftToCreateInput(draft, new Date().toISOString()))}
      />
    </div>
  )
}

function EditWorkoutView({ workoutId }: { workoutId: number | null }) {
  const { preferences, isLoading: isLoadingUnits } = useUnitPreferences()
  const [loaded, setLoaded] = useState<WorkoutDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isNotFound, setIsNotFound] = useState(workoutId === null)

  useEffect(() => {
    if (workoutId === null) {
      return
    }

    async function loadWorkout(id: number) {
      try {
        const workout = await fetchWorkout(id)
        setLoaded(workout)
      } catch (error) {
        if (error instanceof ApiRequestError && (error.status === 404 || error.status === 400)) {
          setIsNotFound(true)
        } else {
          setLoadError(
            error instanceof ApiRequestError ? error.message : 'Unable to load this workout.',
          )
        }
      }
    }

    void loadWorkout(workoutId)
  }, [workoutId])

  if (isNotFound) {
    return (
      <div className="workout-editor-page">
        <div className="workout-editor-card">
          <h1 className="workout-status-title">Workout not found</h1>
          <p className="header-label">It may have been deleted.</p>
          <Link to="/workout" className="dashboard-secondary-button workout-inline-button">
            Back to workouts
          </Link>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="workout-editor-page">
        <div className="workout-editor-card">
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <Link to="/workout" className="dashboard-secondary-button workout-inline-button">
            Back to workouts
          </Link>
        </div>
      </div>
    )
  }

  if (!loaded || workoutId === null || isLoadingUnits) {
    return <LoadingView label="Loading workout…" />
  }

  return (
    <EditWorkoutEditor
      key={loaded.id}
      workout={loaded}
      workoutId={workoutId}
      loadUnit={preferences.workoutLoadUnit}
    />
  )
}

type EditWorkoutEditorProps = { workout: WorkoutDetail; workoutId: number; loadUnit: LoadUnit }

function EditWorkoutEditor({ workout, workoutId, loadUnit }: EditWorkoutEditorProps) {
  // Built once: stored sets keep their own units; the preference only seeds
  // new exercises, and later preference changes never alter this draft.
  const [initialDraft] = useState(() => draftFromWorkout(workout, loadUnit))

  return (
    <div className="workout-editor-page">
      <WorkoutEditor
        mode="edit"
        initialDraft={initialDraft}
        returnTo={`/workout?date=${workout.workoutDate}`}
        // Full replacement: session fields plus every exercise/set; recordedAt is unchanged.
        onSave={(draft) => editWorkout(workoutId, draftToUpdateInput(draft))}
      />
    </div>
  )
}

function parseWorkoutId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function WorkoutEditorPage() {
  const { id } = useParams()

  if (id === undefined) {
    return <CreateWorkoutView />
  }

  const workoutId = parseWorkoutId(id)

  return <EditWorkoutView key={id} workoutId={workoutId} />
}

export default WorkoutEditorPage
