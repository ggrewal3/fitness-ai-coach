export interface CreateFitnessProfileInput {
  dateOfBirth?: string;
  heightCm?: number;
  targetWeightKg?: number;
  goal?: "LOSE_FAT" | "MAINTAIN" | "GAIN_MUSCLE";
  activityLevel?:
    | "SEDENTARY"
    | "LIGHT"
    | "MODERATE"
    | "ACTIVE"
    | "VERY_ACTIVE";
  dietPreference?:
    | "NO_PREFERENCE"
    | "VEGETARIAN"
    | "VEGAN"
    | "PESCATARIAN"
    | "HALAL";
  medicalNotes?: string;
}

export interface UpdateFitnessProfileInput {
  dateOfBirth?: string;
  heightCm?: number;
  targetWeightKg?: number;
  goal?: "LOSE_FAT" | "MAINTAIN" | "GAIN_MUSCLE";
  activityLevel?:
    | "SEDENTARY"
    | "LIGHT"
    | "MODERATE"
    | "ACTIVE"
    | "VERY_ACTIVE";
  dietPreference?:
    | "NO_PREFERENCE"
    | "VEGETARIAN"
    | "VEGAN"
    | "PESCATARIAN"
    | "HALAL";
  medicalNotes?: string;
}