import type { Story } from '@famlin/api-client';
import {
  EMPTY_COMPOSER,
  addOverlay,
  extendStroke,
  firstUnseenIndex,
  hasEdits,
  moveOverlay,
  nextStoryPosition,
  previousStoryPosition,
  removeOverlay,
  startStroke,
  storyAudienceBody,
  strokeToPath,
  undo,
} from '@/utils/stories';

const s = (id: string) => ({ id }) as Story;

describe('story viewer helpers', () => {
  it('resumes at the first unseen story, or the first one when all are seen', () => {
    expect(firstUnseenIndex([{ seen: true }, { seen: false }, { seen: false }])).toBe(1);
    expect(firstUnseenIndex([{ seen: true }, { seen: true }])).toBe(0);
  });

  it('steps through runs and ends after the last story', () => {
    const sequences = [[s('a1'), s('a2')], [s('b1')]];
    expect(nextStoryPosition(sequences, { seq: 0, idx: 0 })).toEqual({ seq: 0, idx: 1 });
    expect(nextStoryPosition(sequences, { seq: 0, idx: 1 })).toEqual({ seq: 1, idx: 0 });
    expect(nextStoryPosition(sequences, { seq: 1, idx: 0 })).toBeNull();
  });

  it('steps back into the previous run and stops at the very start', () => {
    const sequences = [[s('a1'), s('a2')], [s('b1')]];
    expect(previousStoryPosition(sequences, { seq: 1, idx: 0 })).toEqual({ seq: 0, idx: 1 });
    expect(previousStoryPosition(sequences, { seq: 0, idx: 0 })).toEqual({ seq: 0, idx: 0 });
  });
});

describe('story composer model', () => {
  it('adds trimmed overlays and ignores empty text', () => {
    let state = addOverlay(EMPTY_COMPOSER, 'text', '  Hello  ', '#fff');
    state = addOverlay(state, 'text', '   ', '#fff');
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ kind: 'text', value: 'Hello', x: 0.5 });
    expect(hasEdits(state)).toBe(true);
  });

  it('moves an overlay by pixels, clamped to the canvas', () => {
    const state = addOverlay(EMPTY_COMPOSER, 'sticker', '🎉', '#fff');
    const id = state.items[0].id;
    const moved = moveOverlay(state, id, 100, -1000, { width: 400, height: 800 });
    expect(moved.items[0].x).toBeCloseTo(0.75);
    expect(moved.items[0].y).toBe(0);
  });

  it('undoes the most recent overlay or stroke, in order', () => {
    let state = addOverlay(EMPTY_COMPOSER, 'text', 'Hi', '#fff');
    state = startStroke(state, '#000', 6, [1, 1]);
    state = extendStroke(state, [5, 5]);
    expect(state.strokes[0].points).toEqual([
      [1, 1],
      [5, 5],
    ]);

    state = undo(state);
    expect(state.strokes).toHaveLength(0);
    expect(state.items).toHaveLength(1);
    state = undo(state);
    expect(hasEdits(state)).toBe(false);
    expect(undo(state)).toBe(state);
  });

  it('removing an overlay also drops it from the undo history', () => {
    const state = addOverlay(EMPTY_COMPOSER, 'text', 'Hi', '#fff');
    const removed = removeOverlay(state, state.items[0].id);
    expect(removed.history).toHaveLength(0);
  });

  it('turns stroke points into SVG path data, including a single-tap dot', () => {
    expect(strokeToPath([])).toBe('');
    expect(strokeToPath([[2, 3]])).toBe('M2.0 3.0 L2.0 3.0');
    expect(strokeToPath([[0, 0], [10, 5]])).toBe('M0.0 0.0 L10.0 5.0');
  });
});

describe('storyAudienceBody', () => {
  it('builds the same audience shapes the server accepts', () => {
    expect(storyAudienceBody([], null)).toBeNull();
    expect(storyAudienceBody(['g1'], null)).toEqual({ groupId: 'g1' });
    expect(storyAudienceBody(['g1'], 'c1')).toEqual({ groupId: 'g1', circleId: 'c1' });
    // A circle can never be combined with several groups.
    expect(storyAudienceBody(['g1', 'g2'], 'c1')).toEqual({ groupIds: ['g1', 'g2'] });
  });
});
