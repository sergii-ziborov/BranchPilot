import type { ReactNode } from 'react'

/** Dependency-free, per-line syntax highlighter for diff lines. Approximate but fast. */

const KEYWORDS = new Set([
  // shared across js/ts/py/go/rust/java/c-like
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'def', 'default', 'defer', 'del', 'delete', 'do', 'elif', 'else', 'enum', 'export', 'extends',
  'extern', 'false', 'final', 'finally', 'fn', 'for', 'from', 'func', 'function', 'go', 'if',
  'impl', 'import', 'in', 'instanceof', 'interface', 'is', 'lambda', 'let', 'match', 'mod',
  'move', 'mut', 'namespace', 'new', 'nil', 'none', 'null', 'or', 'package', 'pass', 'private',
  'protected', 'public', 'pub', 'raise', 'readonly', 'return', 'self', 'static', 'struct',
  'super', 'switch', 'this', 'throw', 'trait', 'true', 'try', 'type', 'typeof', 'use', 'var',
  'void', 'where', 'while', 'with', 'yield', 'and', 'not', 'undefined', 'string', 'number',
  'boolean', 'int', 'float', 'bool', 'char', 'unsigned', 'long', 'short', 'double',
])

const TYPE_KEYWORDS = new Set([
  'boolean', 'bool', 'char', 'double', 'float', 'int', 'long', 'number', 'short', 'string', 'unsigned', 'void'
])

function commentRe(lang: string): string {
  if (/^(py|rb|sh|bash|zsh|ya?ml|toml|ini|cfg|conf|dockerfile)$/.test(lang)) return '#[^\\n]*'
  if (lang === 'sql') return '--[^\\n]*'
  return '\\/\\/[^\\n]*' // c-like default
}

const cache = new Map<string, RegExp>()
function tokenRe(lang: string): RegExp {
  let re = cache.get(lang)
  if (re) {
    re.lastIndex = 0
    return re
  }
  const comment = commentRe(lang)
  re = new RegExp(
    `(${comment}|\\/\\*.*?\\*\\/)` + // comments
      `|(\`(?:\\\\.|[^\`\\\\])*\`|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')` + // strings
      `|(\\b\\d[\\d_.xXa-fA-F]*\\b)` + // numbers
      `|([A-Za-z_$][A-Za-z0-9_$]*)` + // identifiers
      `|([+\\-*/%=!<>|&^~?:]+)` + // operators
      `|([{}()[\\],.;])`, // punctuation
    'g',
  )
  cache.set(lang, re)
  return re
}

export function langFromPath(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

export function highlight(code: string, lang = ''): ReactNode {
  if (!code) return code
  const re = tokenRe(lang)
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [full, comment, str, num, ident, operator, punctuation] = m
    let cls = ''
    if (comment) cls = 'tok-comment'
    else if (str) cls = 'tok-string'
    else if (num) cls = 'tok-number'
    else if (ident) {
      const rest = code.slice(re.lastIndex).trimStart()
      if (TYPE_KEYWORDS.has(ident)) cls = 'tok-type'
      else if (KEYWORDS.has(ident)) cls = 'tok-keyword'
      else if (rest.startsWith('(')) cls = 'tok-function'
      else if (/^[A-Z]/.test(ident)) cls = 'tok-type'
      else cls = 'tok-variable'
    }
    else if (operator) cls = 'tok-operator'
    else if (punctuation) cls = 'tok-punctuation'
    out.push(cls ? <span key={key++} className={cls}>{full}</span> : full)
    last = m.index + full.length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}
