import { Fragment, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { getUploadUrl, parseWikiMarkdown, type WikiBlock, type WikiInline } from '@famlin/api-client'
import { ShimmerImage } from '@/components/ShimmerImage'

// Renders a Family Wiki page's Markdown (issue #118) from the shared AST
// (@famlin/api-client's parseWikiMarkdown) as plain React elements — never
// dangerouslySetInnerHTML, so a page can't inject markup. In-app links
// ("/posts/…", how a page points at existing Famlin content) go through the
// router; external ones open in a new tab.
export function WikiContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseWikiMarkdown(content), [content])
  return <div className="wiki-content">{blocks.map((block, i) => renderBlock(block, i))}</div>
}

function renderBlock(block: WikiBlock, key: number): ReactNode {
  switch (block.type) {
    case 'heading': {
      // The page title is the <h1>, so content headings start at <h2>.
      const Tag = (['h2', 'h3', 'h4'] as const)[block.level - 1]
      return <Tag key={key}>{renderInline(block.children)}</Tag>
    }
    case 'paragraph':
      return <p key={key}>{renderLines(block.lines)}</p>
    case 'quote':
      return <blockquote key={key}>{renderLines(block.lines)}</blockquote>
    case 'code':
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      )
    case 'rule':
      return <hr key={key} />
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      const isChecklist = block.items.some((item) => item.checked !== null)
      return (
        <Tag key={key} className={isChecklist ? 'wiki-checklist' : undefined}>
          {block.items.map((item, i) => (
            <li key={i}>
              {item.checked !== null && (
                <input type="checkbox" checked={item.checked} readOnly disabled aria-hidden tabIndex={-1} />
              )}
              <span>{renderInline(item.children)}</span>
            </li>
          ))}
        </Tag>
      )
    }
  }
}

function renderLines(lines: WikiInline[][]): ReactNode {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ))
}

function renderInline(nodes: WikiInline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>
      case 'strong':
        return <strong key={i}>{renderInline(node.children)}</strong>
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>
      case 'code':
        return <code key={i}>{node.text}</code>
      case 'link':
        return node.internal ? (
          <Link key={i} to={node.href}>
            {renderInline(node.children)}
          </Link>
        ) : (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(node.children)}
          </a>
        )
      case 'image':
        return (
          <span key={i} className="wiki-image">
            <ShimmerImage src={getUploadUrl(node.src)} alt={node.alt} loading="lazy" />
          </span>
        )
    }
  })
}
