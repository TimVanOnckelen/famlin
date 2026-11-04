import React, { useMemo, type ReactNode } from 'react'
import { View, Text, StyleSheet, Linking, Platform, TouchableOpacity } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { getUploadUrl, isWikiImageSrc, parseWikiMarkdown, type WikiBlock, type WikiInline } from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { MediaThumbnail } from '@/components/MediaThumbnail'

// Where an in-app wiki link ("/posts/…", how a page points at existing
// Famlin content) leads. Anything else internal is ignored.
export function wikiInternalRoute(href: string): { name: string; params: Record<string, string> } | null {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, '')
  const match = /^\/(posts|trips|albums|gift-lists|wiki)\/([^/]+)$/.exec(path)
  if (!match) return null
  const id = decodeURIComponent(match[2])
  switch (match[1]) {
    case 'posts':
      return { name: 'PostDetail', params: { postId: id } }
    case 'trips':
      return { name: 'TripDetail', params: { postId: id } }
    case 'albums':
      return { name: 'AlbumDetail', params: { postId: id } }
    case 'gift-lists':
      return { name: 'GiftList', params: { postId: id } }
    default:
      return { name: 'WikiPage', params: { pageId: id } }
  }
}

function collectImageSrcs(blocks: WikiBlock[]): string[] {
  const srcs: string[] = []
  const visit = (nodes: WikiInline[]) => {
    for (const node of nodes) {
      if (node.type === 'image') {
        if (isWikiImageSrc(node.src)) srcs.push(node.src)
      } else if (node.type === 'strong' || node.type === 'em' || node.type === 'link') visit(node.children)
    }
  }
  for (const block of blocks) {
    if (block.type === 'heading') visit(block.children)
    else if (block.type === 'paragraph' || block.type === 'quote') block.lines.forEach(visit)
    else if (block.type === 'list') block.items.forEach((item) => visit(item.children))
  }
  return srcs
}

// Renders a Family Wiki page's Markdown (issue #118) from the shared AST
// (@famlin/api-client's parseWikiMarkdown) as native Text/View/Image
// elements — never HTML or a WebView, so a page can't inject markup.
export function WikiContent({ content }: { content: string }) {
  const navigation = useNavigation<any>()
  const blocks = useMemo(() => parseWikiMarkdown(content), [content])
  const imageSrcs = useMemo(() => collectImageSrcs(blocks), [blocks])

  function openLink(href: string, internal: boolean) {
    if (internal) {
      const route = wikiInternalRoute(href)
      if (route) navigation.navigate(route.name, route.params)
      return
    }
    if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) void Linking.openURL(href).catch(() => {})
  }

  function openImage(src: string) {
    const index = Math.max(0, imageSrcs.indexOf(src))
    navigation.navigate('ImageViewer', { urls: imageSrcs.map((s) => getUploadUrl(s)), initialIndex: index })
  }

  // Inline nodes -> nested Text. Images can't live inside a Text, so a
  // nested one (inside a link/bold) is collected into `hoisted` and drawn
  // right after the text run it belonged to.
  function inline(nodes: WikiInline[], hoisted: string[], keyPrefix = ''): ReactNode {
    return nodes.map((node, i) => {
      const key = `${keyPrefix}${i}`
      switch (node.type) {
        case 'text':
          return node.text
        case 'strong':
          return (
            <Text key={key} style={styles.strong}>
              {inline(node.children, hoisted, `${key}.`)}
            </Text>
          )
        case 'em':
          return (
            <Text key={key} style={styles.em}>
              {inline(node.children, hoisted, `${key}.`)}
            </Text>
          )
        case 'code':
          return (
            <Text key={key} style={styles.inlineCode}>
              {node.text}
            </Text>
          )
        case 'link':
          return (
            <Text
              key={key}
              style={styles.link}
              accessibilityRole="link"
              onPress={() => openLink(node.href, node.internal)}
            >
              {inline(node.children, hoisted, `${key}.`)}
            </Text>
          )
        case 'image':
          hoisted.push(node.src)
          return null
      }
    })
  }

  function image(src: string, key: string) {
    if (!isWikiImageSrc(src)) return null
    return (
      <TouchableOpacity key={key} activeOpacity={0.85} onPress={() => openImage(src)} testID="wiki-image">
        <MediaThumbnail url={getUploadUrl(src)} style={styles.image} />
      </TouchableOpacity>
    )
  }

  // Lines of inline nodes -> a column of Text runs and images, with a
  // newline between lines (a single newline is a line break, as on web).
  function lines(rows: WikiInline[][], textStyle: object, key: string): ReactNode {
    const out: ReactNode[] = []
    let run: ReactNode[] = []
    let pendingBreak = false
    const flush = () => {
      if (run.length) {
        out.push(
          <Text key={`${key}-t${out.length}`} style={textStyle}>
            {run}
          </Text>
        )
      }
      run = []
    }
    rows.forEach((row, rowIndex) => {
      let buf: WikiInline[] = []
      const pushBuf = () => {
        if (!buf.length) return
        if (pendingBreak && run.length) run.push('\n')
        const hoisted: string[] = []
        run.push(<React.Fragment key={`r${rowIndex}-${run.length}`}>{inline(buf, hoisted)}</React.Fragment>)
        buf = []
        pendingBreak = false
        hoisted.forEach((src, h) => {
          flush()
          out.push(image(src, `${key}-h${rowIndex}-${h}`))
        })
      }
      row.forEach((node, i) => {
        if (node.type === 'image') {
          pushBuf()
          flush()
          out.push(image(node.src, `${key}-i${rowIndex}-${i}`))
        } else {
          buf.push(node)
        }
      })
      pushBuf()
      pendingBreak = true
    })
    flush()
    return out
  }

  function renderBlock(block: WikiBlock, index: number): ReactNode {
    const key = `b${index}`
    switch (block.type) {
      case 'heading':
        return (
          <View key={key} style={styles.block}>
            {lines([block.children], [styles.h1, styles.h2, styles.h3][block.level - 1], key)}
          </View>
        )
      case 'paragraph':
        return (
          <View key={key} style={styles.block}>
            {lines(block.lines, styles.paragraph, key)}
          </View>
        )
      case 'quote':
        return (
          <View key={key} style={[styles.block, styles.quote]}>
            {lines(block.lines, styles.quoteText, key)}
          </View>
        )
      case 'code':
        return (
          <View key={key} style={[styles.block, styles.codeBlock]}>
            <Text style={styles.codeText}>{block.text}</Text>
          </View>
        )
      case 'rule':
        return <View key={key} style={styles.rule} />
      case 'list':
        return (
          <View key={key} style={styles.block}>
            {block.items.map((item, i) => (
              <View key={i} style={styles.listItem}>
                <View style={styles.marker}>
                  {item.checked !== null ? (
                    <Icon
                      name={item.checked ? 'check-square' : 'square'}
                      size={18}
                      color={item.checked ? colors.primary : colors.textMuted}
                    />
                  ) : (
                    <Text style={styles.markerText}>{block.ordered ? `${i + 1}.` : '•'}</Text>
                  )}
                </View>
                <View style={styles.listBody}>{lines([item.children], styles.paragraph, `${key}-${i}`)}</View>
              </View>
            ))}
          </View>
        )
    }
  }

  return <View>{blocks.map(renderBlock)}</View>
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' })

const styles = StyleSheet.create({
  block: { marginBottom: 12 },
  paragraph: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    lineHeight: 24,
    color: colors.textBody,
  },
  h1: { fontFamily: 'Nunito_800ExtraBold', fontSize: 24, lineHeight: 30, color: colors.textTitle },
  h2: { fontFamily: 'Nunito_800ExtraBold', fontSize: 20, lineHeight: 26, color: colors.textTitle },
  h3: { fontFamily: 'Nunito_700Bold', fontSize: 17, lineHeight: 23, color: colors.textTitle },
  strong: { fontFamily: 'Nunito_800ExtraBold' },
  em: { fontStyle: 'italic' },
  inlineCode: { fontFamily: mono, backgroundColor: colors.bg },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.primaryLight, paddingLeft: 12 },
  quoteText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  codeBlock: { backgroundColor: colors.bg, borderRadius: 8, padding: 12 },
  codeText: { fontFamily: mono, fontSize: 14, lineHeight: 20, color: colors.textBody },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  listItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  marker: { width: 26, minHeight: 24, alignItems: 'flex-start', justifyContent: 'center' },
  markerText: { fontFamily: 'Nunito_700Bold', fontSize: 16, lineHeight: 24, color: colors.textMuted },
  listBody: { flex: 1 },
  image: { width: '100%', height: 220, borderRadius: 12, marginVertical: 6, overflow: 'hidden' },
})
