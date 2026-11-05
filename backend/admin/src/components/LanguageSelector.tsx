import { useTranslation } from 'react-i18next'
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, storeLanguage, type SupportedLanguage } from '../i18n'
import { Label } from '@famlin/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@famlin/ui/select'
import { cn } from '@/lib/utils'

// Shared by the sidebar (signed in) and the login/setup screens, which have
// no sidebar yet but still need a way out of the browser-detected language.
export function LanguageSelector({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()

  const handleChange = (lang: SupportedLanguage) => {
    storeLanguage(lang)
    void i18n.changeLanguage(lang)
  }

  return (
    <div className={cn('flex items-center gap-2 text-xs font-semibold text-muted-foreground', className)}>
      <Label htmlFor="admin-language" className="text-xs">
        {t('layout.language')}
      </Label>
      <Select
        items={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang, label: LANGUAGE_NAMES[lang] }))}
        value={i18n.resolvedLanguage ?? i18n.language}
        onValueChange={(value) => handleChange(value as SupportedLanguage)}
      >
        <SelectTrigger id="admin-language" size="sm" className="w-28 bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang} value={lang}>
              {LANGUAGE_NAMES[lang]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
