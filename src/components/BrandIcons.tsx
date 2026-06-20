/**
 * BranchPilot app mark: a git branch growing from a base commit and "piloted"
 * upward by a paper plane. Rounded-badge icon with the brand gradient.
 */
export function BranchPilotMark({ size = 28, className }: { size?: number; className?: string }) {
  const gradId = 'bp-mark-grad'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${gradId})`} />
      <circle cx="16" cy="34" r="3.4" fill="#ffffff" />
      <path
        d="M16 33 V23 Q16 16.5 22.5 14.5"
        stroke="#ffffff"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M37 10 L21.5 16.6 L27.4 19 L29.8 24.9 Z" fill="#ffffff" />
      <path d="M27.4 19 L37 10" stroke="#3b82f6" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Full horizontal lockup: mark + "BranchPilot" wordmark. */
export function BranchPilotLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <BranchPilotMark size={size} />
      <span style={{ fontSize: size * 0.62, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-strong)' }}>
        Branch<span style={{ color: 'var(--accent)' }}>Pilot</span>
      </span>
    </span>
  )
}

/** Brand/logo icons not available in lucide, drawn to match its size/color API. */
export function LinkedinIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}
