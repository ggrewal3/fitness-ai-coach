import { useEffect, useState, type FormEvent } from 'react'
import { ApiRequestError } from '../../services/api'
import {
  MEAL_TYPE_LABELS,
  MEAL_TYPE_ORDER,
  addFoodItem,
  editFoodItem,
  getNutritionEstimate,
  guessMealTypeByTimeOfDay,
  type MealType,
  type NutritionFoodItem,
  type NutritionSource,
} from '../../services/nutrition'

type NutritionValues = {
  calories: string
  proteinGrams: string
  carbsGrams: string
  fatGrams: string
}

type AddFoodModalProps = {
  mode: 'create' | 'edit'
  defaultEntryDate: string
  defaultMealType?: MealType
  existingItem?: NutritionFoodItem
  onClose: () => void
  onSaved: () => void | Promise<void>
}

// The inputs an AI estimate was generated from. Macros are only trustworthy
// as an AI estimate while the current form inputs still match this basis.
type EstimateBasis = {
  foodName: string
  quantity: number
  unit: string
}

function normalizeEstimateText(value: string) {
  return value.trim().toLowerCase()
}

function matchesEstimateBasis(
  basis: EstimateBasis,
  foodName: string,
  quantity: string,
  unit: string,
) {
  return (
    normalizeEstimateText(foodName) === normalizeEstimateText(basis.foodName) &&
    Number.parseFloat(quantity) === basis.quantity &&
    normalizeEstimateText(unit) === normalizeEstimateText(basis.unit)
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return error.message
  }

  return fallback
}

function AddFoodModal({
  mode,
  defaultEntryDate,
  defaultMealType,
  existingItem,
  onClose,
  onSaved,
}: AddFoodModalProps) {
  const [foodName, setFoodName] = useState(existingItem?.foodName ?? '')
  const [quantity, setQuantity] = useState(
    existingItem ? String(existingItem.quantity) : '',
  )
  const [unit, setUnit] = useState(existingItem?.unit ?? 'g')
  const [mealType, setMealType] = useState<MealType>(
    existingItem?.mealType ?? defaultMealType ?? guessMealTypeByTimeOfDay(),
  )
  const [entryDate, setEntryDate] = useState(
    existingItem ? existingItem.entryDate.slice(0, 10) : defaultEntryDate,
  )
  const [source, setSource] = useState<NutritionSource>(
    existingItem?.source ?? 'MANUAL',
  )
  const [note, setNote] = useState<string | null>(null)
  const [values, setValues] = useState<NutritionValues | null>(
    existingItem
      ? {
          calories: String(existingItem.calories),
          proteinGrams: String(existingItem.proteinGrams),
          carbsGrams: String(existingItem.carbsGrams),
          fatGrams: String(existingItem.fatGrams),
        }
      : null,
  )

  const [estimatedFor, setEstimatedFor] = useState<EstimateBasis | null>(
    existingItem?.source === 'AI_TEXT'
      ? {
          foodName: existingItem.foodName,
          quantity: existingItem.quantity,
          unit: existingItem.unit,
        }
      : null,
  )

  const [formError, setFormError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const isEstimateStale =
    values !== null &&
    estimatedFor !== null &&
    !matchesEstimateBasis(estimatedFor, foodName, quantity, unit)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function validateDetails(): { foodName: string; quantity: number; unit: string } | null {
    const trimmedFoodName = foodName.trim()
    const quantityNum = Number.parseFloat(quantity)
    const trimmedUnit = unit.trim()

    if (!trimmedFoodName) {
      setFormError('Enter a food name.')
      return null
    }

    if (!Number.isFinite(quantityNum) || quantityNum <= 0) {
      setFormError('Enter a valid quantity.')
      return null
    }

    if (!trimmedUnit) {
      setFormError('Enter a unit.')
      return null
    }

    return { foodName: trimmedFoodName, quantity: quantityNum, unit: trimmedUnit }
  }

  async function handleEstimate() {
    setFormError(null)
    setAiError(null)

    const details = validateDetails()

    if (!details) {
      return
    }

    const isReEstimate = values !== null

    setIsEstimating(true)

    try {
      const estimate = await getNutritionEstimate(details)

      setValues({
        calories: String(estimate.calories),
        proteinGrams: String(estimate.proteinGrams),
        carbsGrams: String(estimate.carbsGrams),
        fatGrams: String(estimate.fatGrams),
      })
      setNote(estimate.note)
      setSource('AI_TEXT')
      setEstimatedFor(details)
    } catch (error) {
      setAiError(
        isReEstimate
          ? "Couldn't update the nutrition estimate right now. Try again or update the nutrition values manually."
          : getErrorMessage(
              error,
              "Couldn't estimate nutrition right now. You can try again or enter nutrition manually.",
            ),
      )
    } finally {
      setIsEstimating(false)
    }
  }

  function handleManualEntry() {
    setFormError(null)
    setAiError(null)

    const details = validateDetails()

    if (!details) {
      return
    }

    setValues({ calories: '', proteinGrams: '', carbsGrams: '', fatGrams: '' })
    setNote(null)
    setSource('MANUAL')
  }

  // Abandoning a stale AI estimate means the saved values will be user-supplied,
  // not AI-derived, so the stale macros are discarded and provenance becomes
  // MANUAL. Correcting macros on a *current* estimate does not go through here
  // and stays AI_TEXT.
  function handleUpdateNutritionManually() {
    setFormError(null)
    setAiError(null)
    setEstimatedFor(null)
    setNote(null)
    setSource('MANUAL')
    setValues({ calories: '', proteinGrams: '', carbsGrams: '', fatGrams: '' })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)

    if (isEstimateStale) {
      setFormError(
        'Re-estimate with AI or update the nutrition values manually before saving.',
      )
      return
    }

    const details = validateDetails()

    if (!details || !values) {
      return
    }

    if (!entryDate) {
      setFormError('Choose a date.')
      return
    }

    const caloriesNum = Number.parseInt(values.calories, 10)
    const proteinNum = Number.parseFloat(values.proteinGrams)
    const carbsNum = Number.parseFloat(values.carbsGrams)
    const fatNum = Number.parseFloat(values.fatGrams)

    if (!Number.isFinite(caloriesNum) || caloriesNum <= 0) {
      setFormError('Enter valid calories.')
      return
    }

    if (
      !Number.isFinite(proteinNum) ||
      !Number.isFinite(carbsNum) ||
      !Number.isFinite(fatNum) ||
      proteinNum < 0 ||
      carbsNum < 0 ||
      fatNum < 0
    ) {
      setFormError('Enter valid protein, carbs, and fat values.')
      return
    }

    setIsSaving(true)

    try {
      if (mode === 'edit' && existingItem) {
        await editFoodItem(existingItem.id, {
          foodName: details.foodName,
          quantity: details.quantity,
          unit: details.unit,
          mealType,
          entryDate,
          calories: caloriesNum,
          proteinGrams: proteinNum,
          carbsGrams: carbsNum,
          fatGrams: fatNum,
          ...(source !== existingItem.source ? { source } : {}),
        })
      } else {
        await addFoodItem({
          foodName: details.foodName,
          quantity: details.quantity,
          unit: details.unit,
          mealType,
          entryDate,
          calories: caloriesNum,
          proteinGrams: proteinNum,
          carbsGrams: carbsNum,
          fatGrams: fatNum,
          source,
          recordedAt: new Date().toISOString(),
        })
      }

      await onSaved()
      onClose()
    } catch (error) {
      setFormError(getErrorMessage(error, 'Unable to save food item.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? 'Edit food' : 'Add food'}
      >
        <div className="modal-header">
          <h2>{mode === 'edit' ? 'Edit food' : 'Add food'}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <form className="nutrition-form" onSubmit={handleSubmit}>
          <label>
            Food
            <input
              type="text"
              value={foodName}
              onChange={(event) => setFoodName(event.target.value)}
              required
            />
          </label>

          <div className="nutrition-form-row">
            <label>
              Quantity
              <input
                type="number"
                step="0.1"
                min="0"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                required
              />
            </label>

            <label>
              Unit
              <input
                type="text"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                required
              />
            </label>
          </div>

          <div className="nutrition-form-row">
            <label>
              Meal
              <select
                value={mealType}
                onChange={(event) => setMealType(event.target.value as MealType)}
              >
                {MEAL_TYPE_ORDER.map((type) => (
                  <option key={type} value={type}>
                    {MEAL_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Date
              <input
                type="date"
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value)}
                required
              />
            </label>
          </div>

          {mode === 'create' && values === null && (
            <div className="nutrition-form-actions">
              <button type="button" onClick={() => void handleEstimate()} disabled={isEstimating}>
                {isEstimating ? 'Estimating...' : 'Estimate with AI'}
              </button>
              <button
                type="button"
                className="nutrition-secondary-button"
                onClick={handleManualEntry}
              >
                Enter nutrition manually
              </button>
            </div>
          )}

          {aiError && values === null && (
            <div className="nutrition-ai-error">
              <p className="form-error" role="alert">
                {aiError}
              </p>
              <div className="nutrition-form-actions">
                <button type="button" onClick={() => void handleEstimate()}>
                  Try again
                </button>
                <button
                  type="button"
                  className="nutrition-secondary-button"
                  onClick={handleManualEntry}
                >
                  Enter nutrition manually
                </button>
              </div>
            </div>
          )}

          {values && (
            <>
              {isEstimateStale && (
                <div className="nutrition-stale-banner" role="status">
                  <p>
                    Food, quantity, or unit changed. Re-estimate nutrition to
                    update the AI estimate.
                  </p>
                  {aiError && (
                    <p className="form-error" role="alert">
                      {aiError}
                    </p>
                  )}
                  <div className="nutrition-form-actions">
                    <button
                      type="button"
                      onClick={() => void handleEstimate()}
                      disabled={isEstimating}
                    >
                      {isEstimating ? 'Re-estimating...' : 'Re-estimate with AI'}
                    </button>
                    <button
                      type="button"
                      className="nutrition-secondary-button"
                      onClick={handleUpdateNutritionManually}
                      disabled={isEstimating}
                    >
                      Update nutrition manually
                    </button>
                  </div>
                </div>
              )}

              {source === 'AI_TEXT' && estimatedFor && !isEstimateStale && (
                <div className="nutrition-estimate-banner">
                  <p>
                    AI-generated estimate. Actual nutrition may vary based on
                    brand, portion size, and preparation.
                  </p>
                  {note && <p className="header-label">{note}</p>}
                </div>
              )}

              <div className="nutrition-form-row">
                <label>
                  Calories
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={values.calories}
                    onChange={(event) =>
                      setValues((current) =>
                        current
                          ? { ...current, calories: event.target.value }
                          : current,
                      )
                    }
                    required
                    disabled={isEstimateStale}
                  />
                </label>

                <label>
                  Protein (g)
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={values.proteinGrams}
                    onChange={(event) =>
                      setValues((current) =>
                        current
                          ? { ...current, proteinGrams: event.target.value }
                          : current,
                      )
                    }
                    required
                    disabled={isEstimateStale}
                  />
                </label>
              </div>

              <div className="nutrition-form-row">
                <label>
                  Carbs (g)
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={values.carbsGrams}
                    onChange={(event) =>
                      setValues((current) =>
                        current
                          ? { ...current, carbsGrams: event.target.value }
                          : current,
                      )
                    }
                    required
                    disabled={isEstimateStale}
                  />
                </label>

                <label>
                  Fat (g)
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={values.fatGrams}
                    onChange={(event) =>
                      setValues((current) =>
                        current
                          ? { ...current, fatGrams: event.target.value }
                          : current,
                      )
                    }
                    required
                    disabled={isEstimateStale}
                  />
                </label>
              </div>

              <div className="nutrition-form-actions">
                <button type="submit" disabled={isSaving || isEstimateStale}>
                  {isSaving
                    ? 'Saving...'
                    : mode === 'edit'
                      ? 'Save changes'
                      : 'Confirm & Add'}
                </button>
                <button
                  type="button"
                  className="nutrition-secondary-button"
                  onClick={onClose}
                  disabled={isSaving}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  )
}

export default AddFoodModal
