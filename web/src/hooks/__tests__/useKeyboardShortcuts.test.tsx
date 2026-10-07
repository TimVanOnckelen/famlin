import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

function fireKey(key: string, target: Element = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function fireKeyWithModifier(key: string, modifier: 'ctrlKey' | 'metaKey' | 'altKey') {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, [modifier]: true }));
}

describe('useKeyboardShortcuts', () => {
  it('navigates on a "g" then letter chord', () => {
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate, onHelp: vi.fn() }));

    fireKey('g');
    fireKey('p');
    expect(onNavigate).toHaveBeenCalledWith('photos');
  });

  it('maps every chord letter to its view', () => {
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate, onHelp: vi.fn() }));

    for (const [key, view] of [
      ['f', 'feed'],
      ['p', 'photos'],
      ['c', 'chat'],
      ['u', 'profile'],
    ] as const) {
      fireKey('g');
      fireKey(key);
      expect(onNavigate).toHaveBeenLastCalledWith(view);
    }
  });

  it('calls onNewPost for a bare "n"', () => {
    const onNewPost = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onNewPost, onHelp: vi.fn() }));

    fireKey('n');
    expect(onNewPost).toHaveBeenCalledTimes(1);
  });

  it('does nothing for "n" when the page has no composer', () => {
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate, onHelp: vi.fn() }));

    expect(() => fireKey('n')).not.toThrow();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opens the help dialog on "?"', () => {
    const onHelp = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onHelp }));

    fireKey('?');
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it('ignores shortcuts while typing in an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const onNewPost = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onNewPost, onHelp: vi.fn() }));

    fireKey('n', input);
    expect(onNewPost).not.toHaveBeenCalled();
    input.remove();
  });

  it('ignores shortcuts while typing in a textarea', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const onNewPost = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onNewPost, onHelp: vi.fn() }));

    fireKey('n', textarea);
    expect(onNewPost).not.toHaveBeenCalled();
    textarea.remove();
  });

  it('ignores shortcuts while a modal is open', () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
    const onNewPost = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onNewPost, onHelp: vi.fn() }));

    fireKey('n');
    expect(onNewPost).not.toHaveBeenCalled();
    overlay.remove();
  });

  it('ignores the shortcut when a modifier key is held', () => {
    const onNewPost = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onNewPost, onHelp: vi.fn() }));

    fireKeyWithModifier('n', 'ctrlKey');
    fireKeyWithModifier('n', 'metaKey');
    fireKeyWithModifier('n', 'altKey');
    expect(onNewPost).not.toHaveBeenCalled();
  });

  it('expires the "g" chord after the timeout so a later letter does not navigate', () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onNavigate, onHelp: vi.fn() }));

    fireKey('g');
    vi.advanceTimersByTime(1500);
    fireKey('p');

    expect(onNavigate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cleans up its listener on unmount', () => {
    const onNewPost = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ onNavigate: vi.fn(), onNewPost, onHelp: vi.fn() }));
    unmount();

    fireKey('n');
    expect(onNewPost).not.toHaveBeenCalled();
  });
});
