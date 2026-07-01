export type AppThemeCategory = 'core' | 'brand' | 'cinematic' | 'retro'

export interface AppThemeDefinition {
  id: string
  label: string
  dot: string
  description: string
  category: AppThemeCategory
  cssEntry: string
}

export const DEFAULT_APP_THEME = 'github-light'

export const APP_THEMES: AppThemeDefinition[] = [
  { id: 'github-light', label: 'GitHub Light', dot: '#2563eb', description: 'Clean light', category: 'core', cssEntry: 'themes/github-light/index.css' },
  { id: 'github-dark', label: 'GitHub Dark', dot: '#2f81f7', description: 'Clean dark', category: 'core', cssEntry: 'themes/github-dark/index.css' },
  { id: 'cisco-light', label: 'Cisco Light', dot: '#049fd9', description: 'Network lab light', category: 'brand', cssEntry: 'themes/cisco-light/index.css' },
  { id: 'cisco-dark', label: 'Cisco Dark', dot: '#00bceb', description: 'Network lab dark', category: 'brand', cssEntry: 'themes/cisco-dark/index.css' },
  { id: 'cyberboard', label: 'Cyberboard', dot: '#7c3aed', description: 'BranchPilot cyberboard', category: 'brand', cssEntry: 'themes/cyberboard/index.css' },
  { id: 'cyberpunk', label: 'Cyberpunk', dot: '#fcee0a', description: 'Chrome neon', category: 'cinematic', cssEntry: 'themes/cyberpunk/index.css' },
  { id: 'deus-ex', label: 'Deus Ex', dot: '#f2c94c', description: 'Amber HR interface', category: 'cinematic', cssEntry: 'themes/deus-ex/index.css' },
  { id: 'matrix', label: 'Matrix', dot: '#00ff6a', description: 'Code rain', category: 'retro', cssEntry: 'themes/matrix/index.css' },
  { id: 'far-manager', label: 'FAR Manager', dot: '#00a2ff', description: 'Pascal console', category: 'retro', cssEntry: 'themes/far-manager/index.css' }
]

export function isAppThemeId(id: string): boolean {
  return APP_THEMES.some((theme) => theme.id === id)
}
