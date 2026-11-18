import { FormField } from '@famlin/ui/common/form-field'
import { Button } from '@famlin/ui/button'
import { Textarea } from '@famlin/ui/textarea'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

// Where an admin hands over the key of an encrypted backup (issue #495): the
// emergency kit file, its pasted text, or an encrypted export's passphrase.
// The server tells them apart.
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

  return (
    <FormField
      label={allowPassphrase ? t('backupEncryption.keyOrPassphraseLabel') : t('backupEncryption.keyLabel')}
      htmlFor={id}
      hint={t('backupEncryption.keyHint')}
    >
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        placeholder="AGE-SECRET-KEY-1…"
        className="font-mono text-xs"
      />
      <input
        ref={fileRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          // A kit is a few hundred bytes; anything big isn't one.
          if (file && file.size <= 10_000) onChange((await file.text()).trim())
        }}
      />
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => fileRef.current?.click()}>
        {t('backupEncryption.uploadKit')}
      </Button>
    </FormField>
  )
}
