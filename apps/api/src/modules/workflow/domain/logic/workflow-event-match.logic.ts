// Pure match test: does an EVENT-triggered rule subscribe to this eventType?
// triggerConfigJson supports either a single `eventType` string or an `eventTypes` array.
export function ruleMatchesEventType(triggerConfigJson: Record<string, unknown>, eventType: string): boolean {
  if (triggerConfigJson['eventType'] === eventType) return true;
  const list = triggerConfigJson['eventTypes'];
  return Array.isArray(list) && list.includes(eventType);
}
