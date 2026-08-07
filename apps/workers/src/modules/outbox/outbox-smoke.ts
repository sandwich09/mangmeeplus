// Smoke path: claim and immediately mark published (no-op delivery)
export type SmokeOutboxEvent = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  status: string;
};

export function processSmoke(event: SmokeOutboxEvent): { published: boolean; eventId: string } {
  // ponytail: real worker would dispatch to LINE, email, etc. — smoke only
  return { published: true, eventId: event.id };
}

export function computeNextAvailableAt(attempts: number): Date {
  const backoffMs = Math.min(Math.pow(2, attempts) * 1000, 300_000);
  return new Date(Date.now() + backoffMs);
}
