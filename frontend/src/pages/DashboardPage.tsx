import { useEffect, useState } from 'react'
import { useUnitPreferences } from '../context/useUnitPreferences'
import { bodyWeightUnitLabel, formatBodyWeightValue } from '../features/units/unitFormat'
import { Link } from 'react-router-dom'
import AddFoodModal from '../components/nutrition/AddFoodModal'
import { ApiRequestError } from '../services/api'
import {
  fetchWeightCheckIns,
  getLatestCheckIn,
  type WeightCheckIn,
} from '../services/checkins'
import {
  fetchDailySummary,
  getLocalDateString,
  type DailyNutritionSummary,
} from '../services/nutrition'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return error.message
  }

  return fallback
}

function formatRecordedDate(recordedAt: string) {
  return new Date(recordedAt).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  })
}

function DashboardPage() {
  const { preferences, isLoading: isLoadingUnits } = useUnitPreferences()
  const weightUnit = preferences.bodyWeightUnit
  const [summary, setSummary] = useState<DailyNutritionSummary | null>(null)
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [latestCheckIn, setLatestCheckIn] = useState<WeightCheckIn | null>(null)
  const [isLoadingWeight, setIsLoadingWeight] = useState(true)
  const [weightError, setWeightError] = useState<string | null>(null)

  const [isAddFoodOpen, setIsAddFoodOpen] = useState(false)

  async function loadTodaySummary() {
    setIsLoadingSummary(true)
    setSummaryError(null)

    try {
      const data = await fetchDailySummary(getLocalDateString(new Date()))
      setSummary(data)
    } catch (error) {
      setSummaryError(
        getErrorMessage(error, 'Unable to load nutrition summary.'),
      )
    } finally {
      setIsLoadingSummary(false)
    }
  }

  useEffect(() => {
    async function loadInitialSummary() {
      setIsLoadingSummary(true)
      setSummaryError(null)

      try {
        const data = await fetchDailySummary(getLocalDateString(new Date()))
        setSummary(data)
      } catch (error) {
        setSummaryError(
          getErrorMessage(error, 'Unable to load nutrition summary.'),
        )
      } finally {
        setIsLoadingSummary(false)
      }
    }

    async function loadInitialWeight() {
      setIsLoadingWeight(true)
      setWeightError(null)

      try {
        const checkIns = await fetchWeightCheckIns()
        setLatestCheckIn(getLatestCheckIn(checkIns))
      } catch (error) {
        setWeightError(getErrorMessage(error, 'Unable to load weight.'))
      } finally {
        setIsLoadingWeight(false)
      }
    }

    void loadInitialSummary()
    void loadInitialWeight()
  }, [])

  return (
    <div className="dashboard-page">
      <h1 className="dashboard-title">Dashboard</h1>

      <div className="dashboard-grid">
        <div className="dashboard-column">
          <section className="dashboard-card dashboard-nutrition-card">
            <p className="nutrition-eyebrow">Today&apos;s nutrition</p>

            {isLoadingSummary && (
              <p className="nutrition-summary-status">Loading...</p>
            )}

            {!isLoadingSummary && summaryError && (
              <p className="form-error" role="alert">
                {summaryError}
              </p>
            )}

            {!isLoadingSummary && !summaryError && summary && summary.found && (
              <>
                <div className="nutrition-summary-hero">
                  <span className="nutrition-summary-kcal">
                    {summary.totalCalories}
                  </span>
                  <span className="nutrition-summary-kcal-unit">kcal</span>
                </div>

                <p className="nutrition-summary-count">
                  {summary.numberOfFoodItems} food
                  {summary.numberOfFoodItems === 1 ? '' : 's'} logged
                </p>

                <div className="nutrition-summary-macros">
                  <div className="nutrition-macro-tile">
                    <span className="nutrition-macro-label">Protein</span>
                    <span className="nutrition-summary-macro-value">
                      {summary.totalProteinGrams}g
                    </span>
                  </div>
                  <div className="nutrition-macro-tile">
                    <span className="nutrition-macro-label">Carbs</span>
                    <span className="nutrition-summary-macro-value">
                      {summary.totalCarbsGrams}g
                    </span>
                  </div>
                  <div className="nutrition-macro-tile">
                    <span className="nutrition-macro-label">Fat</span>
                    <span className="nutrition-summary-macro-value">
                      {summary.totalFatGrams}g
                    </span>
                  </div>
                </div>
              </>
            )}

            {!isLoadingSummary && !summaryError && summary && !summary.found && (
              <div className="nutrition-summary-empty">
                <p className="nutrition-summary-empty-title">Nothing logged yet</p>
                <p className="header-label">
                  Add a food to see today&apos;s calories and macros.
                </p>
              </div>
            )}

            <div className="dashboard-card-actions">
              <button
                type="button"
                className="dashboard-primary-button"
                onClick={() => setIsAddFoodOpen(true)}
              >
                + Add food
              </button>
              <Link to="/nutrition" className="dashboard-secondary-button">
                View nutrition
              </Link>
            </div>
          </section>

          <section className="dashboard-card dashboard-quick-actions">
            <p className="nutrition-eyebrow">Quick actions</p>

            <div className="dashboard-quick-actions-grid">
              <button
                type="button"
                className="dashboard-secondary-button"
                onClick={() => setIsAddFoodOpen(true)}
              >
                Add food
              </button>
              <Link to="/progress" className="dashboard-secondary-button">
                Log weight
              </Link>
              <Link to="/progress" className="dashboard-secondary-button">
                View progress
              </Link>
              <Link to="/ai-coach" className="dashboard-secondary-button">
                Ask FitAI Coach
              </Link>
            </div>
          </section>
        </div>

        <div className="dashboard-column">
          <section className="dashboard-card dashboard-weight-card">
            <p className="nutrition-eyebrow">Latest weight</p>

            {(isLoadingWeight || isLoadingUnits) && (
              <p className="nutrition-summary-status">Loading...</p>
            )}

            {!isLoadingWeight && weightError && (
              <p className="form-error" role="alert">
                {weightError}
              </p>
            )}

            {!isLoadingWeight && !isLoadingUnits && !weightError && latestCheckIn && (
              <div className="dashboard-weight">
                <div className="nutrition-summary-hero">
                  <span className="nutrition-summary-kcal">
                    {formatBodyWeightValue(latestCheckIn.weightKg, weightUnit)}
                  </span>
                  <span className="nutrition-summary-kcal-unit">{bodyWeightUnitLabel(weightUnit)}</span>
                </div>
                <p className="nutrition-summary-count">
                  Recorded {formatRecordedDate(latestCheckIn.recordedAt)}
                </p>
              </div>
            )}

            {!isLoadingWeight && !isLoadingUnits && !weightError && !latestCheckIn && (
              <div className="nutrition-summary-empty">
                <p className="nutrition-summary-empty-title">
                  No weight logged yet
                </p>
                <p className="header-label">
                  Log a check-in to start tracking your progress.
                </p>
              </div>
            )}

            <div className="dashboard-card-actions">
              <Link to="/progress" className="dashboard-secondary-button">
                Log weight
              </Link>
            </div>
          </section>

          <section className="dashboard-card dashboard-coach-card">
            <p className="nutrition-eyebrow">AI Coach</p>
            <p className="dashboard-card-text">
              Get personalized help with your nutrition, progress and training.
            </p>

            <div className="dashboard-card-actions">
              <Link to="/ai-coach" className="dashboard-secondary-button">
                Ask FitAI Coach
              </Link>
            </div>
          </section>
        </div>
      </div>

      {isAddFoodOpen && (
        <AddFoodModal
          mode="create"
          defaultEntryDate={getLocalDateString(new Date())}
          onClose={() => setIsAddFoodOpen(false)}
          onSaved={loadTodaySummary}
        />
      )}
    </div>
  )
}

export default DashboardPage
