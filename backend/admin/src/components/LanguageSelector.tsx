import { useTranslation } from 'react-i18next';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, storeLanguage, type SupportedLanguage } from '../i18n';

interface LanguageSelectorProps {
  className?: string;
}

// Shared by the sidebar (signed in) and the login/setup screens, which have
// no sidebar yet but still need a way out of the browser-detected language.
export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { t, i18n } = useTranslation();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const lang = e.target.value as SupportedLanguage;
    storeLanguage(lang);
    void i18n.changeLanguage(lang);
  };

  return (
    <label className={className ? `language-selector ${className}` : 'language-selector'}>
      {t('layout.language')}
      <select value={i18n.resolvedLanguage ?? i18n.language} onChange={handleChange}>
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang} value={lang}>
            {LANGUAGE_NAMES[lang]}
          </option>
        ))}
      </select>
    </label>
  );
}
