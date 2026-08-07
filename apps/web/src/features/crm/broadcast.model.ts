export type BroadcastSegmentId = 'all' | 'vip' | 'regular' | 'new';
export type BroadcastToneId = 'fun' | 'friendly' | 'premium' | 'polite' | 'concise';
export type BroadcastColorId = 'green' | 'pink' | 'gold' | 'pastel' | 'dark';

export type BroadcastPreflight = {
  channelId?: string;
  channelConnected: boolean;
  canCreate: boolean;
  canSend: boolean;
  quotaRemaining: number;
  segments: Array<{ id: BroadcastSegmentId; label: string; description: string; count: number }>;
};

export type BroadcastCandidate = { id: string; headline: string; body: string; imageUrl?: string };
export type BroadcastCampaign = {
  id: string;
  name: string;
  segmentLabel: string;
  recipientCount: number;
  status: 'DRAFT' | 'READY' | 'SCHEDULED' | 'QUEUED' | 'SENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  createdAt: string;
};

export function broadcastBlockReason(input: {
  message: string;
  recipientCount: number;
  channelConnected: boolean;
  canSend: boolean;
  quotaRemaining: number;
  busy: boolean;
}): string | null {
  if (input.busy) return 'กำลังดำเนินการ';
  if (!input.canSend) return 'คุณไม่มีสิทธิ์ส่งบรอดแคสต์';
  if (!input.channelConnected) return 'ยังไม่ได้เชื่อมต่อ LINE OA';
  if (!input.message.trim()) return 'กรุณาระบุข้อความ';
  if (input.recipientCount === 0) return 'กลุ่มนี้ไม่มีผู้รับที่ติดต่อได้';
  if (input.quotaRemaining < input.recipientCount) return 'โควตา LINE OA ไม่เพียงพอ';
  return null;
}
