import { LINE_CHAT_ACTIONS, type LineAiConversationContext, type LineAiTaskProjectionV2 } from '@watchdog-bms/contracts';

/** Public catalogue only. Access decisions and all tenant data stay in the turn payload. */
export const LINE_CHAT_ACTIONS_CONTEXT = {
  // Phase A adds the substitute button at Tier 0; its existing typed continuation stays with the current intake catalogue.
  chatActions: LINE_CHAT_ACTIONS.map(({ id, title, group }) => ({ id, title, group })),
};

export const LINE_INTAKE_CHAT_ACTIONS_CONTEXT = {
  chatActions: LINE_CHAT_ACTIONS.filter(action => action.id !== 'substitute_receipt').map(({ id, title, group }) => ({ id, title, group })),
};

export function modelConversationContext(
  context: LineAiConversationContext | undefined,
  tasks?: LineAiTaskProjectionV2,
  hasRetainedSource = false,
  hasOpenQuestion = false,
): LineAiConversationContext | undefined {
  if (!context) return undefined;
  // ponytail: without retained evidence, an unresolved task can still refer to older user text.
  const unfinished = tasks?.tasks.filter(task => !['completed', 'canceled', 'invalidated'].includes(task.state)) ?? [];
  const needsHistory = hasOpenQuestion || unfinished.length > (hasRetainedSource ? 1 : 0);
  return { ...context, recentTurns: needsHistory ? context.recentTurns : context.recentTurns.slice(-4),
    ...(context.recentReads ? { recentReads: context.recentReads.slice(0, 3) } : {}) };
}
