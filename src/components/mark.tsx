export function Mark({ className = "stub" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 36" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M10 6 H46 L58 18 V30 H10 Z" />
      <circle cx="10" cy="14" r="2.15" fill="var(--paper)" />
      <circle cx="10" cy="22" r="2.15" fill="var(--paper)" />
    </svg>
  );
}
