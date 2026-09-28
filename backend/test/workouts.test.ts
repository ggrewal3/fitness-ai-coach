import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  createWorkoutSession,
  getWorkoutHistorySummary,
  updateWorkoutSession,
} from "../src/modules/workouts/workout.service.js";
import {
  builtInExerciseId,
  createApi,
  createTestUser,
  deleteTestUsers,
  errorFields,
  prisma,
  startTestServer,
  type Api,
  type TestServer,
  type TestUser,
} from "./helpers.js";

let server: TestServer;
let api: Api;
const createdUserIds: number[] = [];

let userA: TestUser;
let userB: TestUser;
let benchId: number;
let inclineId: number;
let dipId: number;
let customA: number;
let customB: number;

before(async () => {
  server = await startTestServer();
  api = createApi(server.baseUrl);

  userA = await createTestUser(api, createdUserIds);
  userB = await createTestUser(api, createdUserIds);
  benchId = await builtInExerciseId("barbell-bench-press");
  inclineId = await builtInExerciseId("incline-dumbbell-bench-press");
  dipId = await builtInExerciseId("dip");

  customA = (
    await api("POST", "/api/exercises", { token: userA.token, body: { name: "Landmine Press" } })
  ).body.exercise.id;
  customB = (
    await api("POST", "/api/exercises", { token: userB.token, body: { name: "Secret Sled Push" } })
  ).body.exercise.id;
});

after(async () => {
  await deleteTestUsers(createdUserIds);
  await server.close();
  await prisma.$disconnect();
});

function pushDay(overrides: Record<string, unknown> = {}) {
  return {
    title: "Push Day",
    workoutDate: "2026-09-28",
    trainingType: "STRENGTH",
    durationMinutes: 65,
    notes: "Felt strong on bench.",
    recordedAt: "2026-09-28T18:40:00-07:00",
    exercises: [
      {
        exerciseId: benchId,
        sets: [
          { reps: 10, load: 135, loadUnit: "LB" },
          { reps: 8, load: 155, loadUnit: "LB" },
          { reps: 7, load: 155, loadUnit: "LB" },
        ],
      },
      {
        exerciseId: inclineId,
        sets: [
          { reps: 10, load: 50, loadUnit: "LB" },
          { reps: 9, load: 50, loadUnit: "LB" },
        ],
      },
      {
        exerciseId: dipId,
        sets: [{ reps: 12, load: null, loadUnit: null }, { reps: 10 }],
      },
    ],
    ...overrides,
  };
}

async function createWorkout(user: TestUser, body: Record<string, unknown>) {
  const response = await api("POST", "/api/workouts", { token: user.token, body });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

function simplify(workout: any) {
  return workout.exercises.map((entry: any) => ({
    exerciseId: entry.exercise.id,
    sets: entry.sets.map((set: any) => [set.reps, set.load, set.loadUnit]),
  }));
}

describe("workout authentication", () => {
  it("requires a token on every workout route", async () => {
    for (const [method, path] of [
      ["POST", "/api/workouts"],
      ["GET", "/api/workouts"],
      ["GET", "/api/workouts/1"],
      ["GET", "/api/workouts/date/2026-09-28"],
      ["PATCH", "/api/workouts/1"],
      ["DELETE", "/api/workouts/1"],
    ]) {
      const response = await api(method, path, { body: method === "POST" || method === "PATCH" ? {} : undefined });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });
});

describe("POST /api/workouts", () => {
  it("creates a structured Push Day with ordered exercises and sets", async () => {
    const workout = await createWorkout(userA, pushDay());

    assert.equal(workout.title, "Push Day");
    assert.equal(workout.workoutDate, "2026-09-28");
    assert.equal(workout.trainingType, "STRENGTH");
    assert.equal(workout.durationMinutes, 65);
    assert.equal(workout.notes, "Felt strong on bench.");
    assert.equal(workout.recordedAt, "2026-09-29T01:40:00.000Z");

    assert.deepEqual(
      workout.exercises.map((entry: any) => [entry.position, entry.exercise.name, entry.exercise.isCustom]),
      [
        [0, "Barbell Bench Press", false],
        [1, "Incline Dumbbell Bench Press", false],
        [2, "Dip", false],
      ]
    );
    assert.deepEqual(
      workout.exercises[0].sets.map((set: any) => [set.position, set.reps, set.load, set.loadUnit]),
      [
        [0, 10, 135, "LB"],
        [1, 8, 155, "LB"],
        [2, 7, 155, "LB"],
      ]
    );
  });

  it("stores bodyweight sets with null load and unit", async () => {
    const workout = await createWorkout(userA, pushDay());

    assert.deepEqual(
      workout.exercises[2].sets.map((set: any) => [set.reps, set.load, set.loadUnit]),
      [
        [12, null, null],
        [10, null, null],
      ]
    );
  });

  it("round-trips decimal loads exactly as JSON numbers in the entered unit", async () => {
    const workout = await createWorkout(
      userA,
      pushDay({
        exercises: [
          {
            exerciseId: benchId,
            sets: [
              { reps: 5, load: 155.5, loadUnit: "LB" },
              { reps: 5, load: 72.25, loadUnit: "KG" },
              { reps: 5, load: 0.01, loadUnit: "KG" },
              { reps: 1, load: 2000, loadUnit: "LB" },
              { reps: 3, load: 155.35, loadUnit: "LB" },
            ],
          },
        ],
      })
    );

    const expected = [
      [155.5, "LB"],
      [72.25, "KG"],
      [0.01, "KG"],
      [2000, "LB"],
      [155.35, "LB"],
    ];
    const fetched = await api("GET", `/api/workouts/${workout.id}`, { token: userA.token });

    for (const body of [workout, fetched.body]) {
      assert.deepEqual(
        body.exercises[0].sets.map((set: any) => [set.load, set.loadUnit]),
        expected
      );
      assert.ok(body.exercises[0].sets.every((set: any) => typeof set.load === "number"));
    }

    const stored = await prisma.workoutSet.findMany({
      where: { workoutExercise: { workoutSessionId: workout.id } },
      orderBy: { position: "asc" },
      select: { load: true },
    });
    assert.deepEqual(
      stored.map((set) => set.load?.toString()),
      ["155.5", "72.25", "0.01", "2000", "155.35"]
    );
  });

  it("accepts the user's own custom exercise and repeated exercises", async () => {
    const workout = await createWorkout(
      userA,
      pushDay({
        exercises: [
          { exerciseId: benchId, sets: [{ reps: 5, load: 185, loadUnit: "LB" }] },
          { exerciseId: customA, sets: [{ reps: 10, load: 45, loadUnit: "LB" }] },
          { exerciseId: benchId, sets: [{ reps: 15, load: 95, loadUnit: "LB" }] },
        ],
      })
    );

    assert.deepEqual(
      workout.exercises.map((entry: any) => [entry.position, entry.exercise.id, entry.exercise.isCustom]),
      [
        [0, benchId, false],
        [1, customA, true],
        [2, benchId, false],
      ]
    );
  });

  it("allows session-only workouts with no exercises", async () => {
    const withEmpty = await createWorkout(
      userA,
      pushDay({ title: "Easy run", trainingType: "CARDIO", exercises: [] })
    );
    const { exercises: _omitted, ...withoutExercises } = pushDay({ title: "Yoga", trainingType: "MOBILITY" });
    const omitted = await createWorkout(userA, withoutExercises);

    assert.deepEqual(withEmpty.exercises, []);
    assert.deepEqual(omitted.exercises, []);
  });

  it("normalizes blank notes to null", async () => {
    const workout = await createWorkout(userA, pushDay({ notes: "   ", exercises: [] }));
    assert.equal(workout.notes, null);
  });

  it("rejects exercises that are missing or belong to another user identically", async () => {
    const foreign = await api("POST", "/api/workouts", {
      token: userA.token,
      body: pushDay({ exercises: [{ exerciseId: customB, sets: [{ reps: 5 }] }] }),
    });
    const missing = await api("POST", "/api/workouts", {
      token: userA.token,
      body: pushDay({ exercises: [{ exerciseId: 999999999, sets: [{ reps: 5 }] }] }),
    });

    assert.equal(foreign.status, 400);
    assert.deepEqual(foreign.body, {
      message: "Validation failed.",
      errors: [{ field: "exercises.0.exerciseId", message: "Exercise not found." }],
    });
    assert.deepEqual(missing.body, foreign.body);
  });

  it("reports every invalid exercise reference by position", async () => {
    const response = await api("POST", "/api/workouts", {
      token: userA.token,
      body: pushDay({
        exercises: [
          { exerciseId: benchId, sets: [{ reps: 5 }] },
          { exerciseId: customB, sets: [{ reps: 5 }] },
          { exerciseId: 999999999, sets: [{ reps: 5 }] },
        ],
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body), ["exercises.1.exerciseId", "exercises.2.exerciseId"]);
  });
});

describe("workout validation limits", () => {
  const set = (overrides: Record<string, unknown>) => ({ reps: 5, load: 100, loadUnit: "KG", ...overrides });
  const withSets = (sets: unknown[]) => ({ exercises: [{ exerciseId: 0, sets }] });

  const cases: [string, () => Record<string, unknown>, string][] = [
    ["load without unit", () => withSets([set({ loadUnit: undefined })]), "exercises.0.sets.0.loadUnit"],
    ["load with null unit", () => withSets([set({ loadUnit: null })]), "exercises.0.sets.0.loadUnit"],
    ["unit without load", () => withSets([{ reps: 5, loadUnit: "KG" }]), "exercises.0.sets.0.loadUnit"],
    ["zero load", () => withSets([set({ load: 0 })]), "exercises.0.sets.0.load"],
    ["negative load", () => withSets([set({ load: -5 })]), "exercises.0.sets.0.load"],
    ["load over 2000", () => withSets([set({ load: 2000.01 })]), "exercises.0.sets.0.load"],
    ["load with 3 decimals", () => withSets([set({ load: 1.234 })]), "exercises.0.sets.0.load"],
    ["invalid unit", () => withSets([set({ loadUnit: "STONE" })]), "exercises.0.sets.0.loadUnit"],
    ["zero reps", () => withSets([set({ reps: 0 })]), "exercises.0.sets.0.reps"],
    ["too many reps", () => withSets([set({ reps: 1001 })]), "exercises.0.sets.0.reps"],
    ["fractional reps", () => withSets([set({ reps: 2.5 })]), "exercises.0.sets.0.reps"],
    ["missing reps", () => withSets([{ load: 100, loadUnit: "KG" }]), "exercises.0.sets.0.reps"],
    ["client-supplied set position", () => withSets([set({ position: 0 })]), "exercises.0.sets.0"],
    ["no sets", () => withSets([]), "exercises.0.sets"],
    ["21 sets", () => withSets(Array.from({ length: 21 }, () => set({}))), "exercises.0.sets"],
    [
      "31 exercises",
      () => ({ exercises: Array.from({ length: 31 }, () => ({ exerciseId: 0, sets: [set({})] })) }),
      "exercises",
    ],
    ["exerciseId zero", () => ({ exercises: [{ exerciseId: 0, sets: [set({})] }] }), "exercises.0.exerciseId"],
    ["exerciseId string", () => ({ exercises: [{ exerciseId: "1", sets: [set({})] }] }), "exercises.0.exerciseId"],
    [
      "client-supplied exercise position",
      () => ({ exercises: [{ exerciseId: 1, position: 0, sets: [set({})] }] }),
      "exercises.0",
    ],
    ["missing title", () => ({ title: undefined }), "title"],
    ["blank title", () => ({ title: "   " }), "title"],
    ["title over 100", () => ({ title: "x".repeat(101) }), "title"],
    ["missing workoutDate", () => ({ workoutDate: undefined }), "workoutDate"],
    ["impossible workoutDate", () => ({ workoutDate: "2026-02-30" }), "workoutDate"],
    ["badly formatted workoutDate", () => ({ workoutDate: "09/28/2026" }), "workoutDate"],
    ["zero duration", () => ({ durationMinutes: 0 }), "durationMinutes"],
    ["duration over a day", () => ({ durationMinutes: 1441 }), "durationMinutes"],
    ["invalid training type", () => ({ trainingType: "YOGA" }), "trainingType"],
    ["recordedAt without offset", () => ({ recordedAt: "2026-09-28T10:00:00" }), "recordedAt"],
    ["notes over 2000", () => ({ notes: "x".repeat(2001) }), "notes"],
    ["userId in body", () => ({ userId: 1 }), "body"],
  ];

  for (const [name, overrides, expectedField] of cases) {
    it(`rejects ${name}`, async () => {
      const body: Record<string, unknown> = pushDay();
      const patch = overrides();

      // Replace the placeholder exerciseId 0 in set-level cases with a real one,
      // except where exerciseId itself is under test.
      if (Array.isArray(patch.exercises) && !name.startsWith("exerciseId")) {
        patch.exercises = (patch.exercises as any[]).map((entry) => ({
          ...entry,
          exerciseId: entry.exerciseId === 0 ? benchId : entry.exerciseId,
        }));
      }

      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          delete body[key];
        } else {
          body[key] = value;
        }
      }

      const response = await api("POST", "/api/workouts", { token: userA.token, body });

      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.ok(
        errorFields(response.body).includes(expectedField),
        `expected ${expectedField} in ${JSON.stringify(errorFields(response.body))}`
      );
    });
  }

  it("rejects the legacy session-only body without title and workoutDate", async () => {
    const response = await api("POST", "/api/workouts", {
      token: userA.token,
      body: {
        trainingType: "STRENGTH",
        durationMinutes: 45,
        recordedAt: "2026-09-28T10:00:00Z",
      },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body).sort(), ["title", "workoutDate"]);
  });

  it("accepts the maximum structure: 30 exercises x 20 sets", async () => {
    const workout = await createWorkout(
      userA,
      pushDay({
        exercises: Array.from({ length: 30 }, () => ({
          exerciseId: benchId,
          sets: Array.from({ length: 20 }, (_, index) => ({ reps: index + 1, load: 100, loadUnit: "KG" })),
        })),
      })
    );

    assert.equal(workout.exercises.length, 30);
    assert.ok(workout.exercises.every((entry: any) => entry.sets.length === 20));
    assert.deepEqual(
      workout.exercises[29].sets.map((set: any) => set.position),
      Array.from({ length: 20 }, (_, index) => index)
    );
  });
});

describe("reading workouts", () => {
  let reader: TestUser;
  const ids: Record<string, number> = {};

  before(async () => {
    reader = await createTestUser(api, createdUserIds);

    ids.olderMorning = (await createWorkout(reader, pushDay({ title: "Older", workoutDate: "2026-09-20", recordedAt: "2026-09-20T08:00:00Z" }))).id;
    ids.dayMorning = (await createWorkout(reader, pushDay({ title: "Morning", workoutDate: "2026-09-27", recordedAt: "2026-09-27T07:00:00Z", exercises: [] }))).id;
    ids.dayEvening = (await createWorkout(reader, pushDay({ title: "Evening", workoutDate: "2026-09-27", recordedAt: "2026-09-27T19:00:00Z" }))).id;
    ids.newest = (await createWorkout(reader, pushDay({ title: "Newest", workoutDate: "2026-09-28", recordedAt: "2026-09-28T09:00:00Z" }))).id;
  });

  it("lists summaries newest first with exercise and set counts", async () => {
    const response = await api("GET", "/api/workouts", { token: reader.token });

    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.map((workout: any) => workout.title),
      ["Newest", "Evening", "Morning", "Older"]
    );

    const newest = response.body[0];
    assert.equal(newest.exerciseCount, 3);
    assert.equal(newest.setCount, 7);
    assert.equal(newest.workoutDate, "2026-09-28");
    assert.equal(newest.exercises, undefined);
    assert.equal(response.body[2].exerciseCount, 0);
    assert.equal(response.body[2].setCount, 0);
  });

  it("filters the list by inclusive date range and limit", async () => {
    const range = await api("GET", "/api/workouts?from=2026-09-21&to=2026-09-27", { token: reader.token });
    assert.deepEqual(range.body.map((workout: any) => workout.title), ["Evening", "Morning"]);

    const fromOnly = await api("GET", "/api/workouts?from=2026-09-28", { token: reader.token });
    assert.deepEqual(fromOnly.body.map((workout: any) => workout.title), ["Newest"]);

    const toOnly = await api("GET", "/api/workouts?to=2026-09-20", { token: reader.token });
    assert.deepEqual(toOnly.body.map((workout: any) => workout.title), ["Older"]);

    const limited = await api("GET", "/api/workouts?limit=2", { token: reader.token });
    assert.deepEqual(limited.body.map((workout: any) => workout.title), ["Newest", "Evening"]);
  });

  it("rejects invalid list queries", async () => {
    for (const query of ["?from=2026-09-28&to=2026-09-01", "?from=bad", "?to=2026-13-01", "?limit=0", "?limit=101"]) {
      const response = await api("GET", `/api/workouts${query}`, { token: reader.token });
      assert.equal(response.status, 400, query);
    }
  });

  it("returns a single workout with nested detail", async () => {
    const response = await api("GET", `/api/workouts/${ids.newest}`, { token: reader.token });

    assert.equal(response.status, 200);
    assert.equal(response.body.title, "Newest");
    assert.equal(response.body.exercises.length, 3);

    assert.equal((await api("GET", "/api/workouts/abc", { token: reader.token })).status, 400);
    assert.equal((await api("GET", "/api/workouts/999999999", { token: reader.token })).status, 404);
  });

  it("returns workouts for a workoutDate ordered by recordedAt", async () => {
    const response = await api("GET", "/api/workouts/date/2026-09-27", { token: reader.token });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((workout: any) => workout.id), [ids.dayMorning, ids.dayEvening]);
    assert.equal(response.body[1].exercises.length, 3);

    const empty = await api("GET", "/api/workouts/date/2026-09-01", { token: reader.token });
    assert.deepEqual(empty.body, []);

    for (const date of ["2026-02-30", "notadate", "2026-9-27"]) {
      const invalid = await api("GET", `/api/workouts/date/${date}`, { token: reader.token });
      assert.equal(invalid.status, 400, date);
    }
  });
});

describe("PATCH /api/workouts/:id", () => {
  it("updates session fields only and preserves nested data", async () => {
    const workout = await createWorkout(userA, pushDay());

    const response = await api("PATCH", `/api/workouts/${workout.id}`, {
      token: userA.token,
      body: { title: "Push Day (heavy)", notes: null, workoutDate: "2026-09-27", durationMinutes: 70 },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.title, "Push Day (heavy)");
    assert.equal(response.body.notes, null);
    assert.equal(response.body.workoutDate, "2026-09-27");
    assert.equal(response.body.durationMinutes, 70);
    assert.equal(response.body.trainingType, "STRENGTH");
    assert.deepEqual(response.body.exercises, workout.exercises, "exercise and set rows untouched (same ids)");
  });

  it("replaces nested exercises and sets transactionally", async () => {
    const workout = await createWorkout(userA, pushDay());
    const oldExerciseIds = workout.exercises.map((entry: any) => entry.id);

    const response = await api("PATCH", `/api/workouts/${workout.id}`, {
      token: userA.token,
      body: {
        exercises: [
          { exerciseId: customA, sets: [{ reps: 12, load: 45, loadUnit: "LB" }] },
          {
            exerciseId: benchId,
            sets: [
              { reps: 10, load: 135, loadUnit: "LB" },
              { reps: 8, load: 160, loadUnit: "LB" },
            ],
          },
        ],
      },
    });

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.title, "Push Day");
    assert.deepEqual(simplify(response.body), [
      { exerciseId: customA, sets: [[12, 45, "LB"]] },
      { exerciseId: benchId, sets: [[10, 135, "LB"], [8, 160, "LB"]] },
    ]);
    assert.deepEqual(response.body.exercises.map((entry: any) => entry.position), [0, 1]);
    assert.equal(await prisma.workoutExercise.count({ where: { id: { in: oldExerciseIds } } }), 0);
    assert.equal(
      await prisma.workoutSet.count({ where: { workoutExercise: { workoutSessionId: workout.id } } }),
      3
    );
  });

  it("clears nested exercises with an empty array", async () => {
    const workout = await createWorkout(userA, pushDay());

    const response = await api("PATCH", `/api/workouts/${workout.id}`, {
      token: userA.token,
      body: { exercises: [] },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.exercises, []);
    assert.equal(await prisma.workoutExercise.count({ where: { workoutSessionId: workout.id } }), 0);
    assert.equal(
      await prisma.workoutSet.count({ where: { workoutExercise: { workoutSessionId: workout.id } } }),
      0
    );
  });

  it("leaves the workout untouched when a referenced exercise is invalid", async () => {
    const workout = await createWorkout(userA, pushDay());

    const response = await api("PATCH", `/api/workouts/${workout.id}`, {
      token: userA.token,
      body: { title: "Should not apply", exercises: [{ exerciseId: customB, sets: [{ reps: 5 }] }] },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body), ["exercises.0.exerciseId"]);

    const unchanged = await api("GET", `/api/workouts/${workout.id}`, { token: userA.token });
    assert.deepEqual(unchanged.body, workout);
  });

  it("rejects empty and invalid updates", async () => {
    const workout = await createWorkout(userA, pushDay({ exercises: [] }));

    for (const body of [{}, { title: "" }, { exercises: [{ exerciseId: benchId, sets: [] }] }, { userId: userB.id }]) {
      const response = await api("PATCH", `/api/workouts/${workout.id}`, { token: userA.token, body });
      assert.equal(response.status, 400, JSON.stringify(body));
    }

    assert.equal((await api("PATCH", "/api/workouts/abc", { token: userA.token, body: { title: "X" } })).status, 400);
    assert.equal((await api("PATCH", "/api/workouts/999999999", { token: userA.token, body: { title: "X" } })).status, 404);
  });
});

describe("DELETE /api/workouts/:id", () => {
  it("deletes the workout with its exercises and sets but keeps exercises", async () => {
    const workout = await createWorkout(
      userA,
      pushDay({ exercises: [{ exerciseId: customA, sets: [{ reps: 8, load: 40, loadUnit: "KG" }] }] })
    );
    const workoutExerciseIds = workout.exercises.map((entry: any) => entry.id);

    const response = await api("DELETE", `/api/workouts/${workout.id}`, { token: userA.token });

    assert.equal(response.status, 204);
    assert.equal((await api("GET", `/api/workouts/${workout.id}`, { token: userA.token })).status, 404);
    assert.equal(await prisma.workoutExercise.count({ where: { id: { in: workoutExerciseIds } } }), 0);
    assert.equal(await prisma.workoutSet.count({ where: { workoutExerciseId: { in: workoutExerciseIds } } }), 0);
    assert.ok(await prisma.exercise.findUnique({ where: { id: customA } }), "custom exercise remains");

    assert.equal((await api("DELETE", `/api/workouts/${workout.id}`, { token: userA.token })).status, 404);
  });
});

describe("cross-user workout ownership", () => {
  it("hides another user's workout from every workout route", async () => {
    const workout = await createWorkout(userA, pushDay({ title: "Private A", workoutDate: "2026-08-15", recordedAt: "2026-08-15T10:00:00Z" }));

    const get = await api("GET", `/api/workouts/${workout.id}`, { token: userB.token });
    const patch = await api("PATCH", `/api/workouts/${workout.id}`, { token: userB.token, body: { title: "Hijacked", exercises: [] } });
    const del = await api("DELETE", `/api/workouts/${workout.id}`, { token: userB.token });
    const list = await api("GET", "/api/workouts?limit=100", { token: userB.token });
    const byDate = await api("GET", "/api/workouts/date/2026-08-15", { token: userB.token });

    assert.equal(get.status, 404);
    assert.equal(patch.status, 404);
    assert.equal(del.status, 404);
    assert.deepEqual(get.body, { message: "Workout session not found." });
    assert.ok(!list.body.some((entry: any) => entry.id === workout.id));
    assert.deepEqual(byDate.body, []);

    const stillThere = await api("GET", `/api/workouts/${workout.id}`, { token: userA.token });
    assert.deepEqual(stillThere.body, workout);
  });

  it("rejects another user's custom exercise on update", async () => {
    const workout = await createWorkout(userB, pushDay({ exercises: [{ exerciseId: customB, sets: [{ reps: 5 }] }] }));

    const response = await api("PATCH", `/api/workouts/${workout.id}`, {
      token: userB.token,
      body: { exercises: [{ exerciseId: customA, sets: [{ reps: 5 }] }] },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(errorFields(response.body), ["exercises.0.exerciseId"]);
  });
});

describe("transaction rollback", () => {
  it("keeps the original workout when a nested replacement fails mid-transaction", async () => {
    const workout = await createWorkout(userA, pushDay());

    // 2147483648 overflows the INT column. The HTTP schema would reject it, so
    // the service is called directly to force a database failure after the
    // old nested rows have been deleted inside the transaction.
    await assert.rejects(
      updateWorkoutSession(userA.id, workout.id, {
        title: "Should roll back",
        exercises: [
          { exerciseId: benchId, sets: [{ reps: 5 }] },
          { exerciseId: inclineId, sets: [{ reps: 2147483648 }] },
        ],
      })
    );

    const after = await api("GET", `/api/workouts/${workout.id}`, { token: userA.token });
    assert.deepEqual(after.body, workout);
  });

  it("creates nothing when nested creation fails", async () => {
    const title = `Atomic ${Date.now()}`;

    await assert.rejects(
      createWorkoutSession(userA.id, {
        ...(pushDay({ title }) as any),
        exercises: [
          { exerciseId: benchId, sets: [{ reps: 5 }] },
          { exerciseId: inclineId, sets: [{ reps: 2147483648 }] },
        ],
      })
    );

    assert.equal(await prisma.workoutSession.count({ where: { userId: userA.id, title } }), 0);
  });
});

describe("cascading user deletion", () => {
  it("deletes a user whose workouts use their own custom exercises", async () => {
    const doomedIds: number[] = [];
    const doomed = await createTestUser(api, doomedIds);
    const custom = await api("POST", "/api/exercises", { token: doomed.token, body: { name: "Doomed Curl" } });
    const workout = await createWorkout(
      doomed,
      pushDay({
        exercises: [
          { exerciseId: custom.body.exercise.id, sets: [{ reps: 10, load: 20, loadUnit: "KG" }] },
          { exerciseId: benchId, sets: [{ reps: 5, load: 100, loadUnit: "KG" }] },
        ],
      })
    );
    const builtInCount = await prisma.exercise.count({ where: { userId: null } });

    await prisma.user.delete({ where: { id: doomed.id } });

    assert.equal(await prisma.exercise.count({ where: { userId: doomed.id } }), 0);
    assert.equal(await prisma.workoutSession.count({ where: { userId: doomed.id } }), 0);
    assert.equal(await prisma.workoutExercise.count({ where: { workoutSessionId: workout.id } }), 0);
    assert.equal(
      await prisma.workoutSet.count({ where: { workoutExerciseId: { in: workout.exercises.map((entry: any) => entry.id) } } }),
      0
    );
    assert.equal(await prisma.exercise.count({ where: { userId: null } }), builtInCount);
    assert.ok(await prisma.exercise.findUnique({ where: { id: benchId } }));
  });
});

describe("getWorkoutHistorySummary (AI tool service)", () => {
  it("keeps its existing result shape and metrics", async () => {
    const user = await createTestUser(api, createdUserIds);
    const now = Date.now();
    const earlier = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const later = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    await createWorkout(user, pushDay({ trainingType: "STRENGTH", durationMinutes: 60, recordedAt: earlier, notes: "Heavy" }));
    await createWorkout(user, pushDay({ trainingType: "CARDIO", durationMinutes: 30, recordedAt: later, notes: undefined, exercises: [] }));

    const result = await getWorkoutHistorySummary(user.id, 30);

    assert.equal(result.found, true);
    assert.equal(result.requestedDays, 30);
    assert.deepEqual(Object.keys(result).sort(), ["entries", "found", "requestedDays", "summary"]);
    assert.deepEqual(result.summary, {
      totalSessions: 2,
      totalTrainingMinutes: 90,
      averageDurationMinutes: 45,
      sessionsByType: { STRENGTH: 1, CARDIO: 1, MOBILITY: 0, SPORT: 0, OTHER: 0 },
      latestTrainingType: "CARDIO",
      latestDurationMinutes: 30,
      latestRecordedAt: new Date(later),
    });
    assert.equal(result.entries.length, 2);
    for (const entry of result.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["durationMinutes", "notes", "recordedAt", "trainingType"]);
    }
    assert.equal(result.entries[0].notes, "Heavy");

    const empty = await getWorkoutHistorySummary(userB.id + 1_000_000, 30);
    assert.deepEqual(empty, { found: false, requestedDays: 30, summary: null, entries: [] });
  });
});
