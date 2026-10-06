import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SHORTCUTS } from '@/hooks/shortcuts';
import { useModalFocus } from '@/hooks/useModalFocus';
import './ShortcutsDialog.css';

// The "?" help dialog listing every registered global shortcut (see
// hooks/shortcuts.ts — phase 2's feed shortcuts show up here automatically
// once registered, with no change needed in this file).
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  useModalFocus(cardRef, onClose);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card shortcuts-dialog"
        ref={cardRef}
        role="dialog"
        aria-modal
        aria-label={t('shortcuts.title')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal-title">{t('shortcuts.title')}</h2>
        <ul className="shortcuts-list">
          {SHORTCUTS.map((entry) => (
            <li key={entry.keys.join('+')} className="shortcuts-row">
              <span className="shortcuts-keys">
                {entry.keys.map((key, i) => (
                  <kbd key={i} className="shortcut-key">
                    {key}
                  </kbd>
                ))}
              </span>
              <span className="shortcuts-label">{t(entry.labelKey)}</span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
