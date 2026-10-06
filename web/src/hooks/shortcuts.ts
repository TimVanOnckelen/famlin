export interface ShortcutEntry {
  keys: string[];
  labelKey: string;
}

// The canonical list of global keyboard shortcuts, rendered by
// ShortcutsDialog (the "?" help dialog) and wired up by useKeyboardShortcuts.
// It's a plain mutable module-level array on purpose: phase 2 (feed card
// navigation — j/k/o/l) registers its own entries with
// `SHORTCUTS.push({ keys: ['j'], labelKey: 'shortcuts.nextPost' }, ...)` at
// module load time in whatever file owns those shortcuts, so the help dialog
// picks them up without this file needing to know about feed cards.
export const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['g', 'f'], labelKey: 'shortcuts.goFeed' },
  { keys: ['g', 'p'], labelKey: 'shortcuts.goPhotos' },
  { keys: ['g', 'c'], labelKey: 'shortcuts.goChat' },
  { keys: ['g', 'u'], labelKey: 'shortcuts.goProfile' },
  { keys: ['n'], labelKey: 'shortcuts.newPost' },
  { keys: ['?'], labelKey: 'shortcuts.openHelp' },
];
