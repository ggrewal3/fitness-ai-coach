import { z } from "zod";
import {
  calendarDateInTimeZone,
  daysBetween,
  isCalendarDate,
  isValidTimeZone,
} from "../../lib/dates/calendarDate.js";

/** How far the client's "today" may be from the server's view of that timezone's date. */
export const CLIENT_TODAY_TOLERANCE_DAYS = 1;

/**
 * The user's local calendar context, supplied by the client (ADR-025).
 *
 * The server never decides a user's "today" (ADR-021), but it does not trust
 * the value blindly: `timeZone` must be a real IANA name, and `today` must be
 * within ±1 day of the server's current date in that timezone, which allows
 * for clock skew around midnight while rejecting manipulated dates.
 */
export const clientContextSchema = z
  .object({
    today: z.string().refine(isCalendarDate, "today must be a valid date (YYYY-MM-DD)."),
    timeZone: z.string().max(64).refine(isValidTimeZone, "timeZone must be a valid IANA timezone."),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isValidTimeZone(value.timeZone) || !isCalendarDate(value.today)) {
      return;
    }

    const serverToday = calendarDateInTimeZone(new Date(), value.timeZone);

    if (Math.abs(daysBetween(serverToday, value.today)) > CLIENT_TODAY_TOLERANCE_DAYS) {
      context.addIssue({
        code: "custom",
        path: ["today"],
        message: "today must be the current date in timeZone.",
      });
    }
  });

export type ClientContext = z.infer<typeof clientContextSchema>;
