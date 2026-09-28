// Stable DOM ids for workout editor controls, so the editor can move focus to
// newly added or remaining rows after structural changes.
export const setInputId = (setKey: string, field: 'reps' | 'load' | 'unit') =>
  `workout-set-${setKey}-${field}`

export const addSetButtonId = (exerciseKey: string) =>
  `workout-exercise-${exerciseKey}-add-set`

export const exerciseHeadingId = (exerciseKey: string) =>
  `workout-exercise-${exerciseKey}-heading`

export const moveExerciseButtonId = (exerciseKey: string, direction: -1 | 1) =>
  `workout-exercise-${exerciseKey}-move-${direction === -1 ? 'up' : 'down'}`

export const ADD_EXERCISE_BUTTON_ID = 'workout-add-exercise'
