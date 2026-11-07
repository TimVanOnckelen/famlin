"use strict";
// The Family Wiki's content format (issue #118): a deliberately small
// Markdown subset, parsed into a plain AST that each client renders with its
// own native elements — never into an HTML string — so a page can't inject
// markup or script, and web and mobile share one set of rules.
//
// Blocks: `#`/`##`/`###` headings, paragraphs (single newlines kept as line
// breaks), `-`/`*` and `1.` lists, `- [ ]`/`- [x]` checklists, `>` quotes,
// fenced ``` code, `---` rules. Inline: **bold**, *italic*/_italic_,
// `code`, [links](...), ![images](...) and bare http(s) URLs.
//
// Links are restricted to http(s), mailto:, tel: and in-app paths ("/posts/…"
// — how a page links to existing Famlin content); images to uploaded
// /uploads/ files only, so a page never makes viewers' browsers fetch a
// third-party URL. Anything else renders as its plain text.
Object.defineProperty(exports, "__esModule", { value: true });
exports.wikiLinkTarget = wikiLinkTarget;
exports.isWikiImageSrc = isWikiImageSrc;
exports.parseWikiMarkdown = parseWikiMarkdown;
exports.parseWikiInline = parseWikiInline;
exports.wikiPostPath = wikiPostPath;
exports.wikiPostLabel = wikiPostLabel;
exports.wikiPostLinkMarkdown = wikiPostLinkMarkdown;
const UPLOAD_IMAGE_REGEX = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|gif|webp|heic|heif)$/;
// Classifies a link target: an in-app path, an allowed external URL, or null
// (unsafe — rendered as plain text).
function wikiLinkTarget(href) {
    const trimmed = href.trim();
    if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
        return { href: trimmed, internal: true };
    }
    if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed))
        return { href: trimmed, internal: false };
    return null;
}
function isWikiImageSrc(src) {
    return UPLOAD_IMAGE_REGEX.test(src.trim());
}
const HEADING = /^(#{1,3})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
function parseWikiMarkdown(source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i++;
            continue;
        }
        if (FENCE.test(line)) {
            const code = [];
            i++;
            while (i < lines.length && !FENCE.test(lines[i]))
                code.push(lines[i++]);
            i++; // closing fence (or end of input)
            blocks.push({ type: 'code', text: code.join('\n') });
            continue;
        }
        if (RULE.test(line)) {
            blocks.push({ type: 'rule' });
            i++;
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            blocks.push({
                type: 'heading',
                level: heading[1].length,
                children: parseWikiInline(heading[2].trim()),
            });
            i++;
            continue;
        }
        if (QUOTE.test(line)) {
            const quoted = [];
            while (i < lines.length && QUOTE.test(lines[i]))
                quoted.push(parseWikiInline(QUOTE.exec(lines[i++])[1]));
            blocks.push({ type: 'quote', lines: quoted });
            continue;
        }
        const ordered = ORDERED.test(line);
        if (ordered || UNORDERED.test(line)) {
            const pattern = ordered ? ORDERED : UNORDERED;
            const items = [];
            while (i < lines.length && pattern.test(lines[i])) {
                const text = pattern.exec(lines[i++])[1];
                const box = CHECKBOX.exec(text);
                items.push(box
                    ? { checked: box[1] !== ' ', children: parseWikiInline(box[2]) }
                    : { checked: null, children: parseWikiInline(text) });
            }
            blocks.push({ type: 'list', ordered, items });
            continue;
        }
        const paragraph = [];
        while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
            paragraph.push(parseWikiInline(lines[i++].trim()));
        }
        blocks.push({ type: 'paragraph', lines: paragraph });
    }
    return blocks;
}
function startsBlock(line) {
    return (FENCE.test(line) ||
        RULE.test(line) ||
        HEADING.test(line) ||
        QUOTE.test(line) ||
        UNORDERED.test(line) ||
        ORDERED.test(line));
}
function hrefStop(text, from) {
    let i = from;
    while (i < text.length && text[i] !== ')' && !/\s/.test(text[i]))
        i++;
    return i;
}
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/;
const BARE_URL = /^https?:\/\/[^\s<]*[^\s<.,:;!?"')\]]/;
function parseWikiInline(text) {
    const out = [];
    let buffer = '';
    const flush = () => {
        if (buffer)
            out.push({ type: 'text', text: buffer });
        buffer = '';
    };
    let closeAt = -1; // the next `]` at or after the current `[`
    let failedClose = -1; // a `]` whose `](...)` tail is known not to parse
    let stopAt = -1; // where the href after `closeAt` ends
    let i = 0;
    while (i < text.length) {
        const rest = text.slice(i);
        const ch = text[i];
        const prev = i > 0 ? text[i - 1] : '';
        if (ch === '`') {
            const end = text.indexOf('`', i + 1);
            if (end > i + 1) {
                flush();
                out.push({ type: 'code', text: text.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }
        // [text](href) and ![alt](src). The bracketed part can't contain `]`, so
        // every `[` before the same `]` shares one `](...)` tail: once that tail
        // fails to parse, the rest of those `[` are skipped without a rescan.
        // Without that, a run of unclosed `[` is quadratic — seconds of frozen
        // tab for one 50 KB page.
        if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
            const open = ch === '!' ? i + 1 : i;
            if (closeAt < open)
                closeAt = text.indexOf(']', open);
            // The href ends at the first `)` or whitespace; anything else there
            // can't parse. Scanned once and reused while the `]` stays the same.
            if (closeAt !== -1 && stopAt < closeAt + 2)
                stopAt = hrefStop(text, closeAt + 2);
            if (closeAt !== -1 && closeAt !== failedClose && text[closeAt + 1] === '(' && text[stopAt] === ')') {
                const match = (ch === '!' ? IMAGE : LINK).exec(rest);
                if (match) {
                    flush();
                    if (ch === '!') {
                        if (isWikiImageSrc(match[2]))
                            out.push({ type: 'image', src: match[2].trim(), alt: match[1] });
                        else if (match[1])
                            out.push({ type: 'text', text: match[1] });
                    }
                    else {
                        const target = wikiLinkTarget(match[2]);
                        // A link can't nest: an autolinked URL in the text keeps its text.
                        const children = parseWikiInline(match[1]).flatMap((node) => node.type === 'link' ? node.children : [node]);
                        if (target)
                            out.push({ type: 'link', ...target, children });
                        else
                            out.push(...children);
                    }
                    i += match[0].length;
                    continue;
                }
                failedClose = closeAt;
            }
        }
        if ((ch === 'h' || ch === 'H') && (!prev || /\s|\(/.test(prev))) {
            const url = BARE_URL.exec(rest);
            if (url) {
                flush();
                out.push({ type: 'link', href: url[0], internal: false, children: [{ type: 'text', text: url[0] }] });
                i += url[0].length;
                continue;
            }
        }
        if (rest.startsWith('**')) {
            const end = text.indexOf('**', i + 2);
            if (end > i + 2) {
                flush();
                out.push({ type: 'strong', children: parseWikiInline(text.slice(i + 2, end)) });
                i = end + 2;
                continue;
            }
        }
        // A single * or _ opens emphasis only when followed by a non-space, and
        // _ only at a word start, so snake_case and "2 * 3" stay literal.
        if ((ch === '*' || (ch === '_' && !/[\p{L}\p{N}]/u.test(prev))) && text[i + 1] && text[i + 1] !== ' ') {
            const end = text.indexOf(ch, i + 1);
            const after = text[end + 1] ?? '';
            if (end > i + 1 && text[end - 1] !== ' ' && (ch === '*' || !/[\p{L}\p{N}]/u.test(after))) {
                flush();
                out.push({ type: 'em', children: parseWikiInline(text.slice(i + 1, end)) });
                i = end + 1;
                continue;
            }
        }
        buffer += ch;
        i++;
    }
    flush();
    return out;
}
// The in-app path a wiki link to a post should use: trips, albums and gift
// lists have their own pages; everything else opens as a post. Both clients
// route these paths (web's router, mobile's WikiContent link handler).
function wikiPostPath(post) {
    const id = encodeURIComponent(post.id);
    if (post.type === 'TRIP')
        return `/trips/${id}`;
    if (post.type === 'ALBUM')
        return `/albums/${id}`;
    if (post.type === 'GIFT_LIST')
        return `/gift-lists/${id}`;
    return `/posts/${id}`;
}
// A readable one-line label for a post: its trip/album/gift list title, a
// milestone's tag, or the start of its text — `fallback` (e.g. "Post from
// 4 November") when it has none of those.
function wikiPostLabel(post, fallback, max = 60) {
    const raw = post.trip?.title || post.album?.title || post.giftList?.title || post.milestoneTag || post.content || fallback;
    const oneLine = raw.replace(/\s+/g, ' ').trim() || fallback;
    return oneLine.length > max ? `${oneLine.slice(0, max - 1).trimEnd()}…` : oneLine;
}
// The Markdown inserted by the editors' "Link a post" picker. Brackets are
// stripped from the label so they can't break out of the link syntax.
function wikiPostLinkMarkdown(post, label) {
    // One line, too: the inline parser works per line, so a newline in the
    // label (a multi-line selection) would leave the link unparsed.
    const safe = label.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim() || '…';
    return `[${safe}](${wikiPostPath(post)})`;
}
