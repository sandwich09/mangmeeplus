export const TRUST_WEIGHTS = {
  base: 50,
  tenure30d: 5,
  tenure90d: 10,
  lineLinked: 10,
  consentGranted: 10,
  financialIdentity: 10,
  engagementPerMessage: 1,
  engagementCap: 10,
  keptAppointment: 15,
  keptAppointmentCap: 30,
  noShow: -20,
} as const;

export const TRUST_SCAN = { minInbound: 3, engagementWindowDays: 30, staleAfterDays: 30, batch: 50 } as const;

export type CrmTrustSignals = {
  tenureDays: number;
  lineLinked: boolean;
  consentGranted: boolean;
  financialIdentity: boolean;
  inboundMessages30d: number;
  keptAppointments: number;
  noShows90d: number;
};

export type CrmTrustFactor = { key: string; points: number };

export function trustTierOf(score: number | null): 'NEW' | 'BUILDING' | 'TRUSTED' {
  if (score === null) return 'NEW';
  return score > 80 ? 'TRUSTED' : 'BUILDING';
}

export function computeTrustScore(signals: CrmTrustSignals): { score: number; factors: CrmTrustFactor[] } {
  const factors: CrmTrustFactor[] = [{ key: 'base', points: TRUST_WEIGHTS.base }];
  const tenureDays = positive(signals.tenureDays);
  const inboundMessages30d = positive(signals.inboundMessages30d);
  const keptAppointments = positive(signals.keptAppointments);
  const noShows90d = positive(signals.noShows90d);

  if (tenureDays >= 90) {
    factors.push({ key: 'tenure90d', points: TRUST_WEIGHTS.tenure90d });
  } else if (tenureDays >= 30) {
    factors.push({ key: 'tenure30d', points: TRUST_WEIGHTS.tenure30d });
  }
  if (signals.lineLinked) factors.push({ key: 'lineLinked', points: TRUST_WEIGHTS.lineLinked });
  if (signals.consentGranted) factors.push({ key: 'consentGranted', points: TRUST_WEIGHTS.consentGranted });
  if (signals.financialIdentity) factors.push({ key: 'financialIdentity', points: TRUST_WEIGHTS.financialIdentity });

  const engagement = Math.min(inboundMessages30d * TRUST_WEIGHTS.engagementPerMessage, TRUST_WEIGHTS.engagementCap);
  if (engagement) factors.push({ key: 'engagement', points: engagement });

  const appointments = Math.min(
    keptAppointments * TRUST_WEIGHTS.keptAppointment,
    TRUST_WEIGHTS.keptAppointmentCap,
  );
  if (appointments) factors.push({ key: 'keptAppointment', points: appointments });

  const noShows = noShows90d * TRUST_WEIGHTS.noShow;
  if (noShows) factors.push({ key: 'noShow', points: noShows });

  const preClampScore = factors.reduce((total, factor) => total + factor.points, 0);
  if (preClampScore > 80 && !(signals.lineLinked && (keptAppointments > 0 || signals.financialIdentity))) {
    factors.push({ key: 'level2_requires_verified_identity_and_event', points: 80 - preClampScore });
  }

  const sum = factors.reduce((total, factor) => total + factor.points, 0);
  return { score: Math.max(0, Math.min(100, Math.round(sum))), factors };
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
