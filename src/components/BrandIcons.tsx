/**
 * BranchPilot app mark: a git branch growing from a base commit and merging
 * into a paper plane. Rounded-badge icon with the brand gradient.
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
      <circle cx="15.8" cy="34.2" r="3.5" fill="#ffffff" />
      <path
        d="M15.8 33.2 V24.2 C15.8 18.6 19.2 15.5 24.6 15.5 C26.5 15.5 28.2 16.2 29.8 17.5"
        stroke="#ffffff"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M38.2 9.8 L21.2 17.2 L29 20.2 L31.8 27.3 Z" fill="#ffffff" />
      <path d="M29 20.2 L38.2 9.8" stroke="#4f63f3" strokeWidth="1.15" strokeLinecap="round" />
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
