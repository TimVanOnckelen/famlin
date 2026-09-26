import type { Story, StoryTrayAuthor } from '@famlin/api-client';

// ── Viewer helpers ──────────────────────────────────────────────────────────

// Opening an author in the tray resumes at their first story you haven't
// seen yet (or the first one when you've seen them all), like Instagram.
export function firstUnseenIndex(stories: Pick<Story, 'seen'>[]): number {
  const index = stories.findIndex((s) => !s.seen);
  return index === -1 ? 0 : index;
}

// The viewer plays one run of stories per tray author, in tray order.
export function traySequences(authors: StoryTrayAuthor[]): Story[][] {
  return authors.map((a) => a.stories);
}

export interface StoryPosition {
  seq: number;
  idx: number;
}

// Next position across runs, or null when the last story of the last run
// has played (the viewer closes).
export function nextStoryPosition(sequences: Story[][], { seq, idx }: StoryPosition): StoryPosition | null {
  if (idx + 1 < (sequences[seq]?.length ?? 0)) return { seq, idx: idx + 1 };
  if (seq + 1 < sequences.length) return { seq: seq + 1, idx: 0 };
  return null;
}

// Previous position across runs; stays put at the very first story.
export function previousStoryPosition(sequences: Story[][], { seq, idx }: StoryPosition): StoryPosition {
  if (idx > 0) return { seq, idx: idx - 1 };
  if (seq > 0) return { seq: seq - 1, idx: Math.max(0, (sequences[seq - 1]?.length ?? 1) - 1) };
  return { seq, idx };
}

// ── Composer model ──────────────────────────────────────────────────────────
//
// The composer's overlays (text, emoji stickers, freehand drawing) live only
// on the device: they're flattened into the photo with react-native-view-shot
// before upload, so the server — and the web viewer — only ever see a plain
// JPEG. Positions are stored as fractions of the canvas so they survive a
// layout change (keyboard, rotation of a tablet) without drifting.

export type OverlayKind = 'text' | 'sticker';

export interface OverlayItem {
  id: string;
  kind: OverlayKind;
  value: string;
  color: string;
  // Centre of the item, as a fraction (0–1) of the canvas width/height.
  x: number;
  y: number;
}

export interface Stroke {
  id: string;
  color: string;
  width: number;
  // Canvas-pixel coordinates, in drawing order.
  points: [number, number][];
}

export interface ComposerState {
  items: OverlayItem[];
  strokes: Stroke[];
  // What undo removes next, most recent last.
  history: { kind: 'item' | 'stroke'; id: string }[];
}

export const EMPTY_COMPOSER: ComposerState = { items: [], strokes: [], history: [] };

let nextId = 0;
function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${Date.now()}-${nextId}`;
}

export function addOverlay(state: ComposerState, kind: OverlayKind, value: string, color: string): ComposerState {
  const trimmed = value.trim();
  if (!trimmed) return state;
  const item: OverlayItem = { id: makeId(kind), kind, value: trimmed, color, x: 0.5, y: 0.45 };
  return { ...state, items: [...state.items, item], history: [...state.history, { kind: 'item', id: item.id }] };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Moves an item by a pixel delta, keeping its centre on the canvas so it can
// never be dragged somewhere it can't be dragged back from.
export function moveOverlay(
  state: ComposerState,
  id: string,
  dxPx: number,
  dyPx: number,
  canvas: { width: number; height: number }
): ComposerState {
  if (!canvas.width || !canvas.height) return state;
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === id
        ? { ...item, x: clamp01(item.x + dxPx / canvas.width), y: clamp01(item.y + dyPx / canvas.height) }
        : item
    ),
  };
}

export function removeOverlay(state: ComposerState, id: string): ComposerState {
  return {
    ...state,
    items: state.items.filter((i) => i.id !== id),
    history: state.history.filter((h) => h.id !== id),
  };
}

export function startStroke(state: ComposerState, color: string, width: number, point: [number, number]): ComposerState {
  const stroke: Stroke = { id: makeId('stroke'), color, width, points: [point] };
  return { ...state, strokes: [...state.strokes, stroke], history: [...state.history, { kind: 'stroke', id: stroke.id }] };
}

export function extendStroke(state: ComposerState, point: [number, number]): ComposerState {
  const last = state.strokes[state.strokes.length - 1];
  if (!last) return state;
  return { ...state, strokes: [...state.strokes.slice(0, -1), { ...last, points: [...last.points, point] }] };
}

export function undo(state: ComposerState): ComposerState {
  const last = state.history[state.history.length - 1];
  if (!last) return state;
  return {
    items: last.kind === 'item' ? state.items.filter((i) => i.id !== last.id) : state.items,
    strokes: last.kind === 'stroke' ? state.strokes.filter((s) => s.id !== last.id) : state.strokes,
    history: state.history.slice(0, -1),
  };
}

// SVG path data for a stroke. A single tap draws a dot (a zero-length line
// with round caps), so it still shows up.
export function strokeToPath(points: [number, number][]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  const start = `M${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  if (rest.length === 0) return `${start} L${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  return `${start} ${rest.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}`;
}

export function hasEdits(state: ComposerState): boolean {
  return state.items.length > 0 || state.strokes.length > 0;
}

// ── Audience ────────────────────────────────────────────────────────────────

// Same rules as the server's createStoryBodySchema: one group, several
// (cross-post), or exactly one group narrowed to a circle.
export function storyAudienceBody(
  groupIds: string[],
  circleId: string | null
): { groupId: string; circleId?: string } | { groupIds: string[] } | null {
  if (groupIds.length === 0) return null;
  if (groupIds.length === 1) return circleId ? { groupId: groupIds[0], circleId } : { groupId: groupIds[0] };
  return { groupIds };
}
