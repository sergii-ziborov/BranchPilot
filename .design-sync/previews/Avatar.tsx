import { Avatar } from 'branchpilot'

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <Avatar src="https://github.com/torvalds.png?size=64" name="Linus Torvalds" size="sm" />
    <Avatar src="https://github.com/torvalds.png?size=64" name="Linus Torvalds" size="md" />
    <Avatar src="https://github.com/torvalds.png?size=64" name="Linus Torvalds" size="lg" />
  </div>
)

export const InitialsFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <Avatar name="Ada Lovelace" size="sm" />
    <Avatar name="Grace Hopper" size="md" />
    <Avatar name="Margaret Hamilton" size="lg" />
  </div>
)

export const BrokenImageFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <Avatar src="https://example.invalid/deleted-user.png" name="Dennis Ritchie" size="md" />
    <Avatar src="https://example.invalid/404.png" name="Ken Thompson" size="lg" />
  </div>
)
