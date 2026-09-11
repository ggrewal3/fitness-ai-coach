export interface CreateCheckInInput {
  weightKg: number;
  recordedAt: string;
}

export interface WeightHistoryCheckIn {
  weightKg: number;
  recordedAt: Date;
}

export interface WeightHistorySummary {
  startingWeightKg: number;
  latestWeightKg: number;
  totalChangeKg: number;
  observedDays: number;
  averageChangePerWeekKg: number | null;
  numberOfCheckIns: number;
}

export interface WeightHistorySummaryResult {
  found: boolean;
  requestedDays: number;
  summary: WeightHistorySummary | null;
  checkIns: WeightHistoryCheckIn[];
}
