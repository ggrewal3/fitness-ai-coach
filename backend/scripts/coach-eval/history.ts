// Multi-turn history exactly as the production frontend builds it: the
// frontend's pure buildCoachHistory is loaded at runtime (a path variable
// keeps the backend typecheck from pulling frontend sources into its
// program, as display-units.test.ts does).
import type { CoachResponse } from "../../src/modules/ai/coach.types.js";
import type { ConversationTurn } from "../../src/modules/ai/model.provider.js";
import type { PriorMessage } from "./types.js";

const FRONTEND_COACH_HISTORY = new URL("../../../frontend/src/features/coach/coachHistory.ts", import.meta.url).href;

/** The frontend's message shapes (features/coach/coachTypes.ts), as far as history building reads them. */
type FrontendMessage =
  | { id: string; role: "user"; content: string; createdAt: string; status: "sending" | "failed" | "complete"; error: null }
  | {
      id: string;
      role: "assistant";
      createdAt: string;
      answer: string;
      actionItems: string[];
      followUpQuestion: string | null;
      sources: [];
    };

interface FrontendHistoryModule {
  buildCoachHistory(messages: readonly FrontendMessage[]): ConversationTurn[];
  flattenAssistantMessage(message: { answer: string; actionItems: string[]; followUpQuestion: string | null }): string;
}

let loaded: Promise<FrontendHistoryModule> | undefined;

export function loadFrontendHistory(): Promise<FrontendHistoryModule> {
  loaded ??= import(FRONTEND_COACH_HISTORY) as Promise<FrontendHistoryModule>;
  return loaded;
}

const CREATED_AT = "2026-06-15T12:00:00.000Z";

/** Converts earlier exchanges to the frontend's completed messages. */
export function toFrontendMessages(messages: readonly (PriorMessage | { role: "assistant"; response: CoachResponse })[]): FrontendMessage[] {
  return messages.map((message, index): FrontendMessage => {
    if (message.role === "user") {
      return { id: `u${index}`, role: "user", content: message.content, createdAt: CREATED_AT, status: "complete", error: null };
    }
    const reply = "response" in message ? message.response : { answer: message.answer, actionItems: message.actionItems ?? [], followUpQuestion: message.followUpQuestion ?? null };
    return {
      id: `a${index}`,
      role: "assistant",
      createdAt: CREATED_AT,
      answer: reply.answer,
      actionItems: reply.actionItems,
      followUpQuestion: reply.followUpQuestion,
      sources: [],
    };
  });
}

/**
 * History for the next request. Like the frontend, the question being sent is
 * part of the conversation with status "sending", so buildCoachHistory itself
 * must leave it out (checked by the harness, never patched up here).
 */
export async function buildHistoryForTurn(
  earlier: readonly (PriorMessage | { role: "assistant"; response: CoachResponse })[],
  currentMessage: string
): Promise<ConversationTurn[]> {
  const { buildCoachHistory } = await loadFrontendHistory();
  const messages = toFrontendMessages(earlier);
  messages.push({ id: "current", role: "user", content: currentMessage, createdAt: CREATED_AT, status: "sending", error: null });
  return buildCoachHistory(messages);
}
