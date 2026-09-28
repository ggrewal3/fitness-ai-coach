// Built-in FitAI starter catalogue. Each entry's key is its permanent identity
// (Exercise.builtInKey): the display name may be corrected later, but a key
// must never be changed or reused once released, because workouts reference
// the seeded rows. Entries are never deleted by the seed.
//
// Timed holds (e.g. Plank, Side Plank) are intentionally excluded until
// workout sets support duration.

export interface BuiltInExerciseDefinition {
  key: string;
  name: string;
}

export const BUILT_IN_EXERCISES: readonly BuiltInExerciseDefinition[] = [
  // Chest
  { key: "barbell-bench-press", name: "Barbell Bench Press" },
  { key: "dumbbell-bench-press", name: "Dumbbell Bench Press" },
  { key: "incline-barbell-bench-press", name: "Incline Barbell Bench Press" },
  { key: "incline-dumbbell-bench-press", name: "Incline Dumbbell Bench Press" },
  { key: "decline-barbell-bench-press", name: "Decline Barbell Bench Press" },
  { key: "machine-chest-press", name: "Machine Chest Press" },
  { key: "cable-fly", name: "Cable Fly" },
  { key: "dumbbell-fly", name: "Dumbbell Fly" },
  { key: "pec-deck", name: "Pec Deck" },
  { key: "dip", name: "Dip" },

  // Back
  { key: "pull-up", name: "Pull-Up" },
  { key: "chin-up", name: "Chin-Up" },
  { key: "lat-pulldown", name: "Lat Pulldown" },
  { key: "seated-cable-row", name: "Seated Cable Row" },
  { key: "barbell-row", name: "Barbell Row" },
  { key: "dumbbell-row", name: "Dumbbell Row" },
  { key: "t-bar-row", name: "T-Bar Row" },
  { key: "chest-supported-row", name: "Chest-Supported Row" },
  { key: "straight-arm-pulldown", name: "Straight-Arm Pulldown" },
  { key: "inverted-row", name: "Inverted Row" },
  { key: "back-extension", name: "Back Extension" },
  { key: "conventional-deadlift", name: "Conventional Deadlift" },
  { key: "barbell-shrug", name: "Barbell Shrug" },
  { key: "dumbbell-shrug", name: "Dumbbell Shrug" },

  // Shoulders
  { key: "overhead-press", name: "Overhead Press" },
  { key: "dumbbell-shoulder-press", name: "Dumbbell Shoulder Press" },
  { key: "arnold-press", name: "Arnold Press" },
  { key: "machine-shoulder-press", name: "Machine Shoulder Press" },
  { key: "lateral-raise", name: "Lateral Raise" },
  { key: "cable-lateral-raise", name: "Cable Lateral Raise" },
  { key: "front-raise", name: "Front Raise" },
  { key: "rear-delt-fly", name: "Rear Delt Fly" },
  { key: "face-pull", name: "Face Pull" },
  { key: "upright-row", name: "Upright Row" },

  // Biceps
  { key: "barbell-curl", name: "Barbell Curl" },
  { key: "ez-bar-curl", name: "EZ-Bar Curl" },
  { key: "dumbbell-curl", name: "Dumbbell Curl" },
  { key: "hammer-curl", name: "Hammer Curl" },
  { key: "preacher-curl", name: "Preacher Curl" },
  { key: "incline-dumbbell-curl", name: "Incline Dumbbell Curl" },
  { key: "cable-curl", name: "Cable Curl" },

  // Triceps
  { key: "triceps-pushdown", name: "Triceps Pushdown" },
  { key: "overhead-triceps-extension", name: "Overhead Triceps Extension" },
  { key: "skull-crusher", name: "Skull Crusher" },
  { key: "close-grip-bench-press", name: "Close-Grip Bench Press" },
  { key: "bench-dip", name: "Bench Dip" },
  { key: "triceps-kickback", name: "Triceps Kickback" },

  // Quadriceps
  { key: "back-squat", name: "Back Squat" },
  { key: "front-squat", name: "Front Squat" },
  { key: "goblet-squat", name: "Goblet Squat" },
  { key: "leg-press", name: "Leg Press" },
  { key: "hack-squat", name: "Hack Squat" },
  { key: "bulgarian-split-squat", name: "Bulgarian Split Squat" },
  { key: "walking-lunge", name: "Walking Lunge" },
  { key: "reverse-lunge", name: "Reverse Lunge" },
  { key: "step-up", name: "Step-Up" },
  { key: "leg-extension", name: "Leg Extension" },

  // Hamstrings
  { key: "romanian-deadlift", name: "Romanian Deadlift" },
  { key: "lying-leg-curl", name: "Lying Leg Curl" },
  { key: "seated-leg-curl", name: "Seated Leg Curl" },
  { key: "good-morning", name: "Good Morning" },
  { key: "nordic-hamstring-curl", name: "Nordic Hamstring Curl" },

  // Glutes
  { key: "hip-thrust", name: "Hip Thrust" },
  { key: "glute-bridge", name: "Glute Bridge" },
  { key: "cable-kickback", name: "Cable Kickback" },
  { key: "hip-abduction", name: "Hip Abduction" },
  { key: "sumo-deadlift", name: "Sumo Deadlift" },

  // Calves
  { key: "standing-calf-raise", name: "Standing Calf Raise" },
  { key: "seated-calf-raise", name: "Seated Calf Raise" },

  // Core
  { key: "hanging-leg-raise", name: "Hanging Leg Raise" },
  { key: "cable-crunch", name: "Cable Crunch" },
  { key: "crunch", name: "Crunch" },
  { key: "ab-wheel-rollout", name: "Ab Wheel Rollout" },
  { key: "russian-twist", name: "Russian Twist" },
  { key: "dead-bug", name: "Dead Bug" },
  { key: "pallof-press", name: "Pallof Press" },

  // Bodyweight and conditioning
  { key: "push-up", name: "Push-Up" },
  { key: "burpee", name: "Burpee" },
  { key: "mountain-climber", name: "Mountain Climber" },
  { key: "kettlebell-swing", name: "Kettlebell Swing" },
  { key: "trap-bar-deadlift", name: "Trap Bar Deadlift" },
  { key: "farmers-carry", name: "Farmer’s Carry" },
];
