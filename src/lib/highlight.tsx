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

const MARKDOWN_LANGS = new Set(['markdown', 'md', 'mdx'])
const JSON_LANGS = new Set(['json', 'jsonc'])

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
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  const fileName = normalized.split('/').pop() ?? normalized

  if (/^(bun|composer|deno)\.lock$/.test(fileName)) return 'json'
  if (/^(tsconfig|jsconfig|package-lock)\.json$/.test(fileName)) return 'json'
  if (fileName.endsWith('.lock.json')) return 'json'

  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function highlight(code: string, lang = ''): ReactNode {
  if (!code) return code
  if (MARKDOWN_LANGS.has(lang)) return highlightMarkdown(code)
  if (JSON_LANGS.has(lang)) return highlightJson(code)

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

function highlightJson(code: string): ReactNode {
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b(?:true|false|null)\b)|([{}[\],:])/g
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [full, prop, str, num, literal, punctuation] = m

    if (prop) {
      const colonIndex = full.lastIndexOf(':')
      out.push(<span key={key++} className="tok-variable">{full.slice(0, colonIndex)}</span>)
      out.push(<span key={key++} className="tok-punctuation">{full.slice(colonIndex)}</span>)
    } else if (str) {
      out.push(<span key={key++} className="tok-string">{full}</span>)
    } else if (num) {
      out.push(<span key={key++} className="tok-number">{full}</span>)
    } else if (literal) {
      out.push(<span key={key++} className="tok-keyword">{full}</span>)
    } else if (punctuation) {
      out.push(<span key={key++} className="tok-punctuation">{full}</span>)
    }

    last = m.index + full.length
  }

  if (last < code.length) out.push(code.slice(last))
  return out
}

function highlightMarkdown(code: string): ReactNode {
  const heading = code.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/)

  if (heading) {
    return [
      heading[1],
      <span key="heading-marker" className="tok-keyword">{heading[2]}</span>,
      heading[3],
      ...highlightMarkdownInline(heading[4], 1)
    ]
  }

  const list = code.match(/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/)

  if (list) {
    return [
      list[1],
      <span key="list-marker" className="tok-keyword">{list[2]}</span>,
      list[3],
      ...highlightMarkdownInline(list[4], 1)
    ]
  }

  return highlightMarkdownInline(code, 0)
}

function highlightMarkdownInline(code: string, keySeed: number): ReactNode[] {
  const re = /(`[^`]*`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|https?:\/\/\S+)/g
  const out: ReactNode[] = []
  let last = 0
  let key = keySeed
  let m: RegExpExecArray | null

  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const token = m[0]
    const cls = token.startsWith('`')
      ? 'tok-string'
      : token.startsWith('[') || token.startsWith('http')
        ? 'tok-function'
        : 'tok-type'

    out.push(<span key={key++} className={cls}>{token}</span>)
    last = m.index + token.length
  }

  if (last < code.length) out.push(code.slice(last))
  return out
}
