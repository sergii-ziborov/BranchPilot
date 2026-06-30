export interface FileTypeIconInfo {
  label: string
  tone: string
  title: string
}

const EXACT_FILE_ICONS: Record<string, FileTypeIconInfo> = {
  'dockerfile': { label: 'DK', tone: 'docker', title: 'Dockerfile' },
  'package.json': { label: 'PK', tone: 'package', title: 'Package manifest' },
  'package-lock.json': { label: 'LK', tone: 'lock', title: 'Package lock' },
  'pnpm-lock.yaml': { label: 'LK', tone: 'lock', title: 'Package lock' },
  'yarn.lock': { label: 'LK', tone: 'lock', title: 'Package lock' },
  'tsconfig.json': { label: 'TS', tone: 'ts', title: 'TypeScript config' },
  'vite.config.ts': { label: 'VT', tone: 'config', title: 'Vite config' },
  'vite.config.js': { label: 'VT', tone: 'config', title: 'Vite config' },
  '.gitignore': { label: 'GI', tone: 'git', title: 'Git ignore' },
  '.env': { label: 'ENV', tone: 'config', title: 'Environment file' }
}

const EXTENSION_ICONS: Record<string, FileTypeIconInfo> = {
  ts: { label: 'TS', tone: 'ts', title: 'TypeScript' },
  tsx: { label: 'TSX', tone: 'ts', title: 'TypeScript React' },
  cts: { label: 'CTS', tone: 'ts', title: 'TypeScript CommonJS' },
  mts: { label: 'MTS', tone: 'ts', title: 'TypeScript ES module' },
  js: { label: 'JS', tone: 'js', title: 'JavaScript' },
  jsx: { label: 'JSX', tone: 'js', title: 'JavaScript React' },
  mjs: { label: 'JS', tone: 'js', title: 'JavaScript module' },
  cjs: { label: 'JS', tone: 'js', title: 'CommonJS' },
  css: { label: 'CSS', tone: 'style', title: 'CSS' },
  scss: { label: 'SC', tone: 'style', title: 'SCSS' },
  sass: { label: 'SA', tone: 'style', title: 'Sass' },
  less: { label: 'LS', tone: 'style', title: 'Less' },
  html: { label: 'HT', tone: 'markup', title: 'HTML' },
  htm: { label: 'HT', tone: 'markup', title: 'HTML' },
  svg: { label: 'SV', tone: 'image', title: 'SVG image' },
  json: { label: '{}', tone: 'json', title: 'JSON' },
  jsonc: { label: '{}', tone: 'json', title: 'JSON with comments' },
  md: { label: 'MD', tone: 'doc', title: 'Markdown' },
  mdx: { label: 'MDX', tone: 'doc', title: 'MDX' },
  yml: { label: 'YML', tone: 'config', title: 'YAML' },
  yaml: { label: 'YML', tone: 'config', title: 'YAML' },
  toml: { label: 'TOML', tone: 'config', title: 'TOML' },
  ini: { label: 'INI', tone: 'config', title: 'INI config' },
  env: { label: 'ENV', tone: 'config', title: 'Environment file' },
  sql: { label: 'SQL', tone: 'data', title: 'SQL' },
  db: { label: 'DB', tone: 'data', title: 'Database' },
  sqlite: { label: 'DB', tone: 'data', title: 'SQLite database' },
  png: { label: 'IMG', tone: 'image', title: 'Image' },
  jpg: { label: 'IMG', tone: 'image', title: 'Image' },
  jpeg: { label: 'IMG', tone: 'image', title: 'Image' },
  gif: { label: 'GIF', tone: 'image', title: 'GIF image' },
  webp: { label: 'IMG', tone: 'image', title: 'Image' },
  ico: { label: 'ICO', tone: 'image', title: 'Icon image' },
  icns: { label: 'ICNS', tone: 'image', title: 'Apple icon image' },
  sh: { label: 'SH', tone: 'shell', title: 'Shell script' },
  bash: { label: 'SH', tone: 'shell', title: 'Shell script' },
  zsh: { label: 'SH', tone: 'shell', title: 'Shell script' },
  ps1: { label: 'PS', tone: 'shell', title: 'PowerShell' },
  bat: { label: 'BAT', tone: 'shell', title: 'Batch script' },
  cmd: { label: 'CMD', tone: 'shell', title: 'Command script' },
  py: { label: 'PY', tone: 'python', title: 'Python' },
  go: { label: 'GO', tone: 'go', title: 'Go' },
  rs: { label: 'RS', tone: 'rust', title: 'Rust' },
  java: { label: 'JV', tone: 'java', title: 'Java' },
  cs: { label: 'C#', tone: 'csharp', title: 'C#' },
  cpp: { label: 'C++', tone: 'cpp', title: 'C++' },
  c: { label: 'C', tone: 'cpp', title: 'C' },
  h: { label: 'H', tone: 'cpp', title: 'Header' },
  xml: { label: 'XML', tone: 'markup', title: 'XML' }
}

const COMPOUND_EXTENSION_ICONS: Array<[string, FileTypeIconInfo]> = [
  ['.d.ts', { label: 'DTS', tone: 'ts', title: 'TypeScript declaration' }],
  ['.d.cts', { label: 'DTS', tone: 'ts', title: 'TypeScript CommonJS declaration' }],
  ['.d.mts', { label: 'DTS', tone: 'ts', title: 'TypeScript ES module declaration' }],
  ['.test.ts', { label: 'TST', tone: 'ts', title: 'TypeScript test' }],
  ['.test.tsx', { label: 'TST', tone: 'ts', title: 'TypeScript React test' }],
  ['.spec.ts', { label: 'TST', tone: 'ts', title: 'TypeScript spec' }],
  ['.spec.tsx', { label: 'TST', tone: 'ts', title: 'TypeScript React spec' }],
  ['.config.cts', { label: 'CFG', tone: 'config', title: 'TypeScript CommonJS config' }],
  ['.config.mts', { label: 'CFG', tone: 'config', title: 'TypeScript ES module config' }]
]

export function fileTypeIconForPath(path: string): FileTypeIconInfo {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? path.toLowerCase()
  const exact = EXACT_FILE_ICONS[fileName]
  if (exact) return exact

  const compound = COMPOUND_EXTENSION_ICONS.find(([suffix]) => fileName.endsWith(suffix))
  if (compound) return compound[1]

  const extension = fileName.includes('.') ? fileName.split('.').pop() ?? '' : ''
  const byExtension = EXTENSION_ICONS[extension]
  if (byExtension) return byExtension

  return { label: 'FILE', tone: 'default', title: 'File' }
}
