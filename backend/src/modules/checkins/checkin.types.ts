export interface CreateCheckInInput {
  weightKg: number;
  recordedAt: string;
}

export interface WeightTrendPeriod {
  /** Inclusive calendar dates in the user's timezone. */
  startDate: string;
  endDate: string;
  checkInCount: number;
  daysWithCheckIns: number;
  /** Mean of the daily averages; null when the period has no check-ins. */
  averageWeightKg: number | null;
}

export interface WeightTrendResult {
  today: string;
  requestedDays: number;
  /** The most recent check-in on or before today, even if older than every window. */
  latestCheckIn: { date: string; weightKg: number; daysAgo: number } | null;
  currentPeriod: WeightTrendPeriod;
  previousPeriod: WeightTrendPeriod;
  comparison: {
    sufficient: boolean;
    rule: string;
    /** Why the comparison is unavailable (empty when sufficient). */
    reasons: string[];
    averageChangeKg: number | null;
    weeklyPercentChange: number | null;
  };
  /** Check-ins in the requested window, newest first. */
  history: { startDate: string; endDate: string; checkIns: { date: string; weightKg: number }[] };
}
