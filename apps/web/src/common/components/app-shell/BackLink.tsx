import Link from 'next/link';

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mangmee-btn mangmee-btn-secondary w-fit">
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}
