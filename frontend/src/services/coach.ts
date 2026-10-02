import {
  postCoachMessage,
  type CoachHistoryTurn,
  type CoachReply,
  type CoachRequestBody,
  type CoachSource,
  type CoachSourceType,
} from "./api"

export type { CoachHistoryTurn, CoachReply, CoachRequestBody, CoachSource, CoachSourceType }

/** Asks the AI Coach; pass `signal` to abandon the request (e.g. New conversation). */
export async function askCoach(body: CoachRequestBody, signal?: AbortSignal): Promise<CoachReply> {
  return postCoachMessage(body, signal)
}
