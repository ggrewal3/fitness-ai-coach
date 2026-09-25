import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AddFoodModal from '../components/nutrition/AddFoodModal'
import { ApiRequestError } from '../services/api'
import {
  MEAL_TYPE_LABELS,
  MEAL_TYPE_ORDER,
  SOURCE_LABELS,
  fetchDailySummary,
  fetchFoodItems,
  formatDateLabel,
  getEntryDateString,
  getLocalDateString,
  removeFoodItem,
  shiftDateString,
  type DailyNutritionSummary,
  type MealType,
  type NutritionFoodItem,
} from '../services/nutrition'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return error.message
  }

  return fallback
}

type FoodRowProps = {
  item: NutritionFoodItem
  onEdit: () => void
  onDelete: () => void
  isDeleting: boolean
}

function FoodRow({ item, onEdit, onDelete, isDeleting }: FoodRowProps) {
  const sourceLabel = SOURCE_LABELS[item.source]

  return (
    <li className="nutrition-food-row">
      <div className="nutrition-food-info">
        <span className="nutrition-food-name">{item.foodName}</span>
        <span className="nutrition-food-meta">
          {item.quantity} {item.unit}
          {sourceLabel && (
            <span className="nutrition-source-badge">{sourceLabel}</span>
          )}
        </span>
      </div>

      <div className="nutrition-food-macros">
        <span className="nutrition-food-calories">{item.calories} kcal</span>
        <span className="nutrition-food-macro-line">
          {item.proteinGrams}P • {item.carbsGrams}C • {item.fatGrams}F
        </span>
      </div>

      <div className="nutrition-food-actions">
        <button type="button" className="nutrition-edit-button" onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="nutrition-delete-button"
          onClick={onDelete}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </li>
  )
}

type ModalState =
  | { mode: 'create'; defaultMealType?: MealType }
  | { mode: 'edit'; item: NutritionFoodItem }

function NutritionPage() {
  const [selectedDate, setSelectedDate] = useState(() =>
    getLocalDateString(new Date()),
  )

  const [allFoodItems, setAllFoodItems] = useState<NutritionFoodItem[]>([])
  const [isLoadingFoods, setIsLoadingFoods] = useState(true)
  const [foodsError, setFoodsError] = useState<string | null>(null)

  const [summary, setSummary] = useState<DailyNutritionSummary | null>(null)
  const [isLoadingSummary, setIsLoadingSummary] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)

  const [modalState, setModalState] = useState<ModalState | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function loadFoodItems() {
    setIsLoadingFoods(true)
    setFoodsError(null)

    try {
      const data = await fetchFoodItems()
      setAllFoodItems(data)
    } catch (error) {
      setFoodsError(getErrorMessage(error, 'Unable to load food items.'))
    } finally {
      setIsLoadingFoods(false)
    }
  }

  async function loadSummary(date: string) {
    setIsLoadingSummary(true)
    setSummaryError(null)

    try {
      const data = await fetchDailySummary(date)
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
    async function loadInitialFoodItems() {
      setIsLoadingFoods(true)
      setFoodsError(null)

      try {
        const data = await fetchFoodItems()
        setAllFoodItems(data)
      } catch (error) {
        setFoodsError(getErrorMessage(error, 'Unable to load food items.'))
      } finally {
        setIsLoadingFoods(false)
      }
    }

    void loadInitialFoodItems()
  }, [])

  useEffect(() => {
    async function loadSelectedDaySummary() {
      setIsLoadingSummary(true)
      setSummaryError(null)

      try {
        const data = await fetchDailySummary(selectedDate)
        setSummary(data)
      } catch (error) {
        setSummaryError(
          getErrorMessage(error, 'Unable to load nutrition summary.'),
        )
      } finally {
        setIsLoadingSummary(false)
      }
    }

    void loadSelectedDaySummary()
  }, [selectedDate])

  async function handleModalSaved() {
    await loadFoodItems()
    await loadSummary(selectedDate)
  }

  async function handleDelete(item: NutritionFoodItem) {
    if (!window.confirm(`Delete "${item.foodName}"?`)) {
      return
    }

    setDeleteError(null)
    setDeletingId(item.id)

    try {
      await removeFoodItem(item.id)
      await loadFoodItems()
      await loadSummary(selectedDate)
    } catch (error) {
      setDeleteError(getErrorMessage(error, 'Unable to delete food item.'))
    } finally {
      setDeletingId(null)
    }
  }

  function openAddFoodModal(defaultMealType?: MealType) {
    setModalState({ mode: 'create', defaultMealType })
  }

  function openEditFoodModal(item: NutritionFoodItem) {
    setModalState({ mode: 'edit', item })
  }

  function closeModal() {
    setModalState(null)
  }

  const todayString = getLocalDateString(new Date())
  const isToday = selectedDate === todayString
  const dateLabel = isToday ? 'Today' : formatDateLabel(selectedDate)

  const foodsForSelectedDate = allFoodItems.filter(
    (item) => getEntryDateString(item) === selectedDate,
  )

  const foodsByMeal = MEAL_TYPE_ORDER.reduce<Record<MealType, NutritionFoodItem[]>>(
    (acc, mealType) => {
      acc[mealType] = foodsForSelectedDate.filter(
        (item) => item.mealType === mealType,
      )
      return acc
    },
    { BREAKFAST: [], LUNCH: [], DINNER: [], SNACK: [], OTHER: [] },
  )

  const visibleMealTypes = MEAL_TYPE_ORDER.filter(
    (mealType) => mealType !== 'OTHER' || foodsByMeal.OTHER.length > 0,
  )

  return (
    <div className="nutrition-page">
      <div className="nutrition-page-header">
        <h1>Nutrition</h1>

        <div className="nutrition-date-nav">
          <button
            type="button"
            className="nutrition-nav-button"
            onClick={() =>
              setSelectedDate((current) => shiftDateString(current, -1))
            }
            aria-label="Previous day"
          >
            &lsaquo;
          </button>

          <button
            type="button"
            className="nutrition-date-label"
            onClick={() => setSelectedDate(todayString)}
          >
            {dateLabel}
          </button>

          <button
            type="button"
            className="nutrition-nav-button"
            onClick={() =>
              setSelectedDate((current) => shiftDateString(current, 1))
            }
            aria-label="Next day"
          >
            &rsaquo;
          </button>
        </div>
      </div>

      <div className="nutrition-layout">
        <aside className="nutrition-summary-card">
          <p className="nutrition-eyebrow">Daily summary</p>

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
                Add a food to see this day&apos;s calories and macros.
              </p>
            </div>
          )}

          <div className="nutrition-actions-row">
            <button type="button" onClick={() => openAddFoodModal()}>
              + Add Food
            </button>
            <Link to="/ai-coach" className="nutrition-secondary-button">
              Ask AI Coach
            </Link>
          </div>
        </aside>

        <div className="nutrition-main">
          {foodsError && (
            <p className="form-error" role="alert">
              {foodsError}
            </p>
          )}

          {deleteError && (
            <p className="form-error" role="alert">
              {deleteError}
            </p>
          )}

          {isLoadingFoods ? (
            <p>Loading meals...</p>
          ) : (
            <div className="nutrition-meals">
              {visibleMealTypes.map((mealType) => {
                const items = foodsByMeal[mealType]

                return (
                  <section key={mealType} className="nutrition-meal-section">
                    <div className="nutrition-meal-header">
                      <h3>{MEAL_TYPE_LABELS[mealType]}</h3>
                      <button
                        type="button"
                        className="nutrition-add-meal-button"
                        onClick={() => openAddFoodModal(mealType)}
                      >
                        + Add
                      </button>
                    </div>

                    {items.length === 0 ? (
                      <p className="nutrition-meal-empty">
                        Nothing logged yet.{' '}
                        <button
                          type="button"
                          className="nutrition-inline-add"
                          onClick={() => openAddFoodModal(mealType)}
                        >
                          + Add {MEAL_TYPE_LABELS[mealType].toLowerCase()}
                        </button>
                      </p>
                    ) : (
                      <ul className="nutrition-food-list">
                        {items.map((item) => (
                          <FoodRow
                            key={item.id}
                            item={item}
                            onEdit={() => openEditFoodModal(item)}
                            onDelete={() => void handleDelete(item)}
                            isDeleting={deletingId === item.id}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {modalState && (
        <AddFoodModal
          mode={modalState.mode}
          defaultEntryDate={selectedDate}
          defaultMealType={
            modalState.mode === 'create' ? modalState.defaultMealType : undefined
          }
          existingItem={
            modalState.mode === 'edit' ? modalState.item : undefined
          }
          onClose={closeModal}
          onSaved={handleModalSaved}
        />
      )}
    </div>
  )
}

export default NutritionPage
