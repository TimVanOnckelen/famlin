export type WikiInline = {
    type: 'text';
    text: string;
} | {
    type: 'strong';
    children: WikiInline[];
} | {
    type: 'em';
    children: WikiInline[];
} | {
    type: 'code';
    text: string;
} | {
    type: 'link';
    href: string;
    internal: boolean;
    children: WikiInline[];
} | {
    type: 'image';
    src: string;
    alt: string;
};
export interface WikiListItem {
    checked: boolean | null;
    children: WikiInline[];
}
export type WikiBlock = {
    type: 'heading';
    level: 1 | 2 | 3;
    children: WikiInline[];
} | {
    type: 'paragraph';
    lines: WikiInline[][];
} | {
    type: 'list';
    ordered: boolean;
    items: WikiListItem[];
} | {
    type: 'quote';
    lines: WikiInline[][];
} | {
    type: 'code';
    text: string;
} | {
    type: 'rule';
};
export declare function wikiLinkTarget(href: string): {
    href: string;
    internal: boolean;
} | null;
export declare function isWikiImageSrc(src: string): boolean;
export declare function parseWikiMarkdown(source: string): WikiBlock[];
export declare function parseWikiInline(text: string): WikiInline[];
