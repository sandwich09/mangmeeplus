// Coin-with-sprout mark from the มั่งมี Brand Kit ("เหรียญงอกเงย").
export function MangmeeLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <path d="M24 23c0-6 0-9 0-12" stroke="#FCD34D" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 15c-1.6-3-4.4-4-7.6-3.6 .4 3.4 3.2 4.8 6 4.6" fill="#86EFAC" />
      <path d="M24 13c1.6-2.6 4.2-3.4 7-3 -.3 3-2.8 4.2-5.4 4" fill="#BBF7D0" />
      <circle cx="24" cy="31" r="11" fill="#FCD34D" stroke="#FBBF24" strokeWidth="1.5" />
      <path
        d="M24 26v10M22 28h3.2a2 2 0 0 1 0 4H22m0 0h3.6a2 2 0 0 1 0 4H22"
        stroke="#B45309"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// Rising-bars mark of มั่งมีพลัส, the same mark as the public home header.
export function MangmeePlusMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={Math.round((size * 30) / 28)} height={size} viewBox="0 0 30 28" fill="none" aria-hidden>
      <rect x="0" y="16" width="5.5" height="12" rx="2.75" fill="#4ADE80" />
      <rect x="8" y="10.5" width="5.5" height="17.5" rx="2.75" fill="#16A34A" />
      <rect x="16" y="5.5" width="5.5" height="22.5" rx="2.75" fill="#22C55E" />
      <rect x="24" y="0" width="5.5" height="28" rx="2.75" fill="#F59E0B" />
    </svg>
  );
}
