import { User } from 'lucide-react'

export function CommitIdentityAvatar({ avatarUrl, large = false }: { avatarUrl?: string; large?: boolean }) {
  return (
    <span className={large ? 'commit-identity-avatar large' : 'commit-identity-avatar'} aria-hidden="true">
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      )}
      <User className="commit-identity-avatar-fallback" size={large ? 18 : 16} />
    </span>
  )
}
