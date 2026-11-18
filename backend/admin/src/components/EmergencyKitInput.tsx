import { Button } from '@famlin/ui/button'
import { Textarea } from '@famlin/ui/textarea'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

// Where an admin hands over the key of an encrypted backup (issue #495): the
// emergency kit file, its pasted text, or — for an encrypted export — the
// passphrase. The server tells them apart.
export function EmergencyKitInput({
  value,
  onChange,
  allowPassphrase = false,
}: {
  value: string
  onChange: (value: string) => void
  allowPassphrase?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)

  const readFile = async (file: File | undefined) => {
    if (!file) return
    // A kit is a few hundred bytes; anything big isn't one.
    if (file.size > 10_000) return
    onChange((await file.text()).trim())
  }

  return (
    <div className="emergency-kit-input">
      <label htmlFor={id}>
        {allowPassphrase ? t('backupEncryption.keyOrPassphraseLabel') : t('backupEncryption.keyLabel')}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        placeholder="AGE-SECRET-KEY-1…"
      />
      <div className="emergency-kit-input-row">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(e) => {
            void readFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          {t('backupEncryption.uploadKit')}
        </Button>
        <span className="hint">{t('backupEncryption.keyHint')}</span>
      </div>
    </div>
  )
}
