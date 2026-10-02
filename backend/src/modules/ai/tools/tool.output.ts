// Bounding what tools send to the model. Every list a tool returns is capped
// and reports what was left out, so a truncated result never looks complete.

/** Caps for model-facing tool output. */
export const TOOL_OUTPUT_LIMITS = {
  weightCheckIns: 60,
  nutritionFoodsPerDay: 15,
  workoutSessions: 10,
  exercisesPerSession: 8,
  setsPerExercise: 6,
  exerciseSummaries: 15,
  /** Serialized size a tool aims for; it drops the oldest details to fit. */
  resultBudgetChars: 28_000,
  activityDays: 90,
  /** Workout notes: user-authored free text (untrusted data). */
  notesChars: 280,
  /** Titles, food and exercise names: user-authored text (untrusted data). */
  nameChars: 80,
  /** Free-text food units ("g", "slice"). */
  unitChars: 20,
} as const;

// C0/C1 control characters: JSON escapes each one to six characters ("\u0001").
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
// Unpaired UTF-16 surrogates: JSON escapes each one to six characters too.
const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Shortens user-authored text; the ellipsis marks that something was cut.
 *
 * Control characters become spaces and lone surrogates become U+FFFD first,
 * so no character serializes to more than two JSON characters ("\"" or a
 * surrogate pair). That keeps every tool's worst-case size predictable.
 */
export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = [...text.replace(LONE_SURROGATES, "\uFFFD").replace(CONTROL_CHARACTERS, " ")];

  if (chars.length <= maxChars) {
    return { text: chars.join(""), truncated: false };
  }

  return { text: `${chars.slice(0, maxChars - 1).join("")}…`, truncated: true };
}

/** Keeps the first `max` items and says how many there were. */
export function capList<T>(items: readonly T[], max: number): { items: T[]; total: number; truncated: boolean } {
  return { items: items.slice(0, max), total: items.length, truncated: items.length > max };
}
