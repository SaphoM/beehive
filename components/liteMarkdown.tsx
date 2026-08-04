// Shared lite-markdown renderer for the exact bounded subset this app's two
// AI-summary sources both use: ## / ### headers, **bold**, [text](url)
// links, "- " bullets. Originally written inline in FathomPanel.tsx for
// Fathom's (third-party) AI summary markdown — extracted here, verbatim,
// so the new Meeting Notes feature's LLM-generated summaries (which the
// prompt in providers/llm.js deliberately constrains to this exact same
// subset) can reuse it instead of maintaining a second, identical copy.
// FathomPanel.tsx now imports LiteMarkdown from here instead of its own
// former FathomSummary — a pure extraction, not a rewrite: same regexes,
// same styles, same output for the same input.
function renderBold(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-b${i}`} style={{ color: '#ccc', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-p${i}`}>{part}</span>
  )
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = linkRe.exec(text))) {
    if (m.index > lastIndex) nodes.push(...renderBold(text.slice(lastIndex, m.index), `${keyPrefix}-t${i++}`))
    nodes.push(
      <a key={`${keyPrefix}-l${i++}`} href={m[2]} target="_blank" rel="noreferrer" style={{ color: '#f5a623', textDecoration: 'none' }}>
        {renderBold(m[1], `${keyPrefix}-lb${i}`)}
      </a>
    )
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) nodes.push(...renderBold(text.slice(lastIndex), `${keyPrefix}-t${i++}`))
  return nodes
}

export function LiteMarkdown({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = []
  let listBuffer: string[] = []
  let listKey = 0

  const flushList = () => {
    if (listBuffer.length === 0) return
    const key = `ul-${listKey++}`
    blocks.push(
      <ul key={key} style={{ margin: '2px 0 8px', paddingLeft: 18 }}>
        {listBuffer.map((item, i) => <li key={i} style={{ marginBottom: 4 }}>{renderInline(item, `${key}-${i}`)}</li>)}
      </ul>
    )
    listBuffer = []
  }

  markdown.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) { flushList(); return }

    const bullet = trimmed.match(/^-\s+(.*)/)
    if (bullet) { listBuffer.push(bullet[1]); return }
    flushList()

    const h2 = trimmed.match(/^##\s+(.*)/)
    const h3 = trimmed.match(/^###\s+(.*)/)
    if (h2) {
      blocks.push(<div key={i} style={{ color: '#eee', fontSize: 13, fontWeight: 600, marginTop: 10 }}>{h2[1]}</div>)
    } else if (h3) {
      blocks.push(<div key={i} style={{ color: '#bbb', fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>{h3[1]}</div>)
    } else {
      blocks.push(<div key={i} style={{ marginBottom: 4 }}>{renderInline(trimmed, `p-${i}`)}</div>)
    }
  })
  flushList()

  return <>{blocks}</>
}
