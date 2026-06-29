import { useState } from 'react'
import { User, UserRound } from 'lucide-react'

type AvatarSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: 'commit-identity-avatar',
  md: 'commit-identity-avatar large',
  lg: 'contributor-avatar'
}

const FALLBACK_ICON_SIZE: Record<AvatarSize, number> = {
  sm: 16,
  md: 18,
  lg: 18
}

function computeInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Circular avatar: shows the image when available, else initials/icon fallback (falls back on image load error). */
export function Avatar({
  src,
  name,
  size = 'md'
}: {
  /** Avatar image URL; when omitted or it fails to load, the initials/icon fallback is shown. */
  src?: string
  /** Display name used to derive initials and the accessible label. */
  name: string
  /** Visual size variant. Defaults to `'md'`. */
  size?: AvatarSize
}) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed
  const initials = computeInitials(name)
  const FallbackIcon = size === 'lg' ? UserRound : User

  return (
    <span className={SIZE_CLASS[size]} title={name} aria-label={name} role="img">
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={() => {
            setFailed(true)
          }}
        />
      ) : initials ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <FallbackIcon
          className={size === 'lg' ? 'contributor-avatar-placeholder' : 'commit-identity-avatar-fallback'}
          size={FALLBACK_ICON_SIZE[size]}
          aria-hidden="true"
        />
      )}
    </span>
  )
}
