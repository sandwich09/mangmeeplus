export function loginChannelAvailability(config: {
  lineLoginChannelId?: string;
  lineLiffId?: string;
  lineLoginChannelSecret?: string;
  lineWebLoginEnabled?: boolean;
}) {
  const lineReady = Boolean(config.lineWebLoginEnabled && config.lineLoginChannelId && config.lineLoginChannelSecret);
  return {
    password: { available: true as const },
    phoneOtp: { available: false as const, reason: 'deferred_to_future_release' as const },
    line: lineReady
      ? { available: true as const, channelId: config.lineLoginChannelId as string }
      : { available: false as const, reason: 'deferred_to_future_release' as const },
  };
}
