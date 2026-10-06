import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/Icon';
import './ScreenHeader.css';

// A shared "back bar" — back button + title — for any screen reached by
// drilling into something rather than tapping a sidebar/BottomNav tab (Chat,
// Profile, Trip detail, Album detail). Replaces each page's own floating
// "← Back to the feed" link with one consistent, mobile-ScreenHeader-like
// pattern.
export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="screen-header">
      <button type="button" className="screen-header-back" onClick={onBack} aria-label={t('common.back')}>
        <Icon name="chevron-left" size={18} strokeWidth={2.5} />
      </button>
      <h1 className="screen-header-title">{title}</h1>
    </div>
  );
}
