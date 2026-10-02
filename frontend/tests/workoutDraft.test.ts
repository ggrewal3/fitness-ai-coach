// workoutLoadUnit only seeds new exercises; stored sets keep their own unit
// and are never converted (ADR-007).
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  createEmptyDraft,
  draftFromWorkout,
  draftToUpdateInput,
  isDraftEqual,
  workoutDraftReducer,
  type WorkoutDraft,
} from "../src/features/workout/workoutDraft"
import type { Exercise } from "../src/services/exercises"
import type { LoadUnit, WorkoutDetail } from "../src/services/workouts"

const squat = { id: 1, name: "Back squat", isCustom: false } as Exercise
const press = { id: 2, name: "Bench press", isCustom: false } as Exercise

function workoutWith(unit: LoadUnit): WorkoutDetail {
  return {
    id: 7,
    title: "Legs",
    workoutDate: "2026-10-01",
    trainingType: "STRENGTH",
    durationMinutes: 60,
    notes: null,
    recordedAt: "2026-10-01T18:00:00.000Z",
    exercises: [
      {
        id: 11,
        position: 0,
        exercise: squat,
        sets: [
          { id: 101, position: 0, reps: 8, load: 100, loadUnit: unit },
          { id: 102, position: 1, reps: 10, load: null, loadUnit: null },
        ],
      },
    ],
  } as WorkoutDetail
}

function addExercise(draft: WorkoutDraft, exercise: Exercise, key: string): WorkoutDraft {
  return workoutDraftReducer(draft, { type: "addExercise", exercise, exerciseKey: key, setKey: `${key}-set` })
}

describe("new exercises start in the preferred unit", () => {
  for (const unit of ["LB", "KG"] as const) {
    test(`${unit} preference`, () => {
      const draft = addExercise(createEmptyDraft("2026-10-02", unit), squat, "e1")
      assert.equal(draft.exercises[0].sets[0].loadUnit, unit)
    })
  }

  test("not the unit another exercise in the draft uses", () => {
    let draft = addExercise(createEmptyDraft("2026-10-02", "LB"), squat, "e1")
    draft = workoutDraftReducer(draft, { type: "updateSet", exerciseKey: "e1", setKey: "e1-set", patch: { load: "20", loadUnit: "KG" } })
    draft = addExercise(draft, press, "e2")
    assert.equal(draft.exercises[1].sets[0].loadUnit, "LB")
  })

  test("Add Set copies the previous set's load and unit", () => {
    let draft = addExercise(createEmptyDraft("2026-10-02", "LB"), squat, "e1")
    draft = workoutDraftReducer(draft, { type: "updateSet", exerciseKey: "e1", setKey: "e1-set", patch: { reps: "5", load: "100", loadUnit: "KG" } })
    draft = workoutDraftReducer(draft, { type: "addSet", exerciseKey: "e1", setKey: "s2" })
    assert.deepEqual(draft.exercises[0].sets[1], { key: "s2", reps: "5", load: "100", loadUnit: "KG" })
  })
})

describe("existing workouts keep their stored units", () => {
  test("a KG workout stays KG under an LB preference (and vice versa)", () => {
    for (const [stored, preference] of [["KG", "LB"], ["LB", "KG"]] as const) {
      const draft = draftFromWorkout(workoutWith(stored), preference)
      assert.equal(draft.exercises[0].sets[0].load, "100")
      assert.equal(draft.exercises[0].sets[0].loadUnit, stored)
      assert.deepEqual(draftToUpdateInput(draft).exercises?.[0].sets, [
        { reps: 8, load: 100, loadUnit: stored },
        { reps: 10, load: null, loadUnit: null },
      ])
    }
  })

  test("the preference never leaks into stored sets: KG and LB preferences save the same payload", () => {
    for (const stored of ["KG", "LB"] as const) {
      assert.deepEqual(
        draftToUpdateInput(draftFromWorkout(workoutWith(stored), "KG")),
        draftToUpdateInput(draftFromWorkout(workoutWith(stored), "LB")),
      )
    }
  })

  test("an unchanged draft is clean; an edited one is not", () => {
    const initial = draftFromWorkout(workoutWith("KG"), "LB")
    const reopened = workoutDraftReducer(initial, { type: "replaceDraft", draft: draftFromWorkout(workoutWith("KG"), "LB") })
    assert.ok(isDraftEqual(reopened, initial))
    const edited = workoutDraftReducer(initial, { type: "updateSet", exerciseKey: "exercise-11", setKey: "set-101", patch: { loadUnit: "LB" } })
    assert.ok(!isDraftEqual(edited, initial))
  })

  test("a new exercise added to a KG workout uses the LB preference", () => {
    const draft = addExercise(draftFromWorkout(workoutWith("KG"), "LB"), press, "e2")
    assert.equal(draft.exercises[0].sets[0].loadUnit, "KG")
    assert.equal(draft.exercises[1].sets[0].loadUnit, "LB")
  })
})

describe("explicit unit changes are label-only", () => {
  test("100 kg changed to LB becomes 100 lb, not 220.46 lb", () => {
    const draft = workoutDraftReducer(draftFromWorkout(workoutWith("KG"), "LB"), {
      type: "updateSet",
      exerciseKey: "exercise-11",
      setKey: "set-101",
      patch: { loadUnit: "LB" },
    })
    assert.deepEqual(draftToUpdateInput(draft).exercises?.[0].sets[0], { reps: 8, load: 100, loadUnit: "LB" })
  })
})

describe("the default unit is captured when the draft is built", () => {
  test("it lives in the draft, so a later preference cannot change it", () => {
    const draft = createEmptyDraft("2026-10-02", "KG")
    assert.equal(draft.newExerciseLoadUnit, "KG")
    // Adding exercises later uses the captured unit, whatever the preference is now.
    assert.equal(addExercise(draft, squat, "e1").exercises[0].sets[0].loadUnit, "KG")
  })

  test("it is never sent to the API", () => {
    const draft = createEmptyDraft("2026-10-02", "KG")
    assert.ok(!("newExerciseLoadUnit" in draftToUpdateInput(draft)))
  })
})
