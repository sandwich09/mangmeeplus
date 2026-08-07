export function loginChannelAvailability(_config: { lineLoginChannelId?: string; lineLiffId?: string }) {
  return {
    password: { available: true as const },
    phoneOtp: { available: false as const, reason: 'deferred_to_future_release' as const },
    line: { available: false as const, reason: 'deferred_to_future_release' as const },
  };
}
