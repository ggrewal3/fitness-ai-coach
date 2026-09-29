import type { z } from "zod";
import type {
  updateAccountProfileSchema,
  updatePreferencesSchema,
} from "./account.schemas.js";

export type WeightUnit = "KG" | "LB";
export type HeightUnit = "CM" | "FT_IN";

export interface UserPreferences {
  bodyWeightUnit: WeightUnit;
  workoutLoadUnit: WeightUnit;
  heightUnit: HeightUnit;
}

export interface AccountResponse {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  countryCode: string | null;
  bio: string | null;
  createdAt: Date;
  preferences: UserPreferences;
}

export type UpdateAccountProfileInput = z.output<typeof updateAccountProfileSchema>;
export type UpdatePreferencesInput = z.output<typeof updatePreferencesSchema>;
