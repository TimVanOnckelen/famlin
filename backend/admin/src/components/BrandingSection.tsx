import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Eye, Image } from 'lucide-react'
import { api, AdminBranding, DerivedBrand } from '../api/client'
import { FormField, FormRow } from '@famlin/ui/common/form-field'
import { SaveBar } from '@famlin/ui/common/save-bar'
import { StateMessage } from '@famlin/ui/common/state-message'
import { Button } from '@famlin/ui/button'
import { Input } from '@famlin/ui/input'
import { cn } from '@/lib/utils'

const CUSTOM = 'custom'
const HEX_RE = /^#?[0-9a-fA-F]{6}$/
const NAME_MAX = 40
const withHash = (hex: string) => (hex.startsWith('#') ? hex : `#${hex}`).toLowerCase()

// Per-family branding (issue #164): preset or custom color, family name and
// logo. Has its own save (PUT /api/admin/branding) rather than joining the
// generic settings form, since the server validates and derives the palette.
export function BrandingSection() {
  const { t } = useTranslation()
  const [branding, setBranding] = useState<AdminBranding | null>(null)
  const [preset, setPreset] = useState('teal')
  const [customColor, setCustomColor] = useState('#006e94')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<DerivedBrand | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = (b: AdminBranding) => {
    setBranding(b)
    setPreset(b.preset)
    if (b.color) setCustomColor(b.color)
    setName(b.name)
    setPreview(b.derived)
  }

  useEffect(() => {
    api
      .getBranding()
      .then(load)
      .catch((err) => setError(err.message))
  }, [])

  const colorValid = preset !== CUSTOM || HEX_RE.test(customColor)

  // Live preview: the server derives the palette (one implementation for
  // every client), debounced so typing a hex doesn't fire a request per key.
  useEffect(() => {
    if (!branding || !colorValid) return
    const timer = setTimeout(() => {
      api
        .previewBranding({ preset, color: preset === CUSTOM ? withHash(customColor) : null })
        .then(setPreview)
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [branding, preset, customColor, colorValid])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 4000)
    return () => clearTimeout(timer)
  }, [saved])

  if (!branding) {
    return error ? (
      <StateMessage variant="error">{error}</StateMessage>
    ) : (
      <StateMessage variant="loading">{t('common.loading')}</StateMessage>
    )
  }

  const dirty =
    preset !== branding.preset ||
    name.trim() !== branding.name ||
    (preset === CUSTOM && withHash(customColor) !== branding.color)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      load(
        await api.updateBranding({ preset, color: preset === CUSTOM ? withHash(customColor) : null, name: name.trim() })
      )
      setSaved(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogo = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const updated = await api.uploadBrandingLogo(file)
      setBranding((prev) => (prev ? { ...prev, logoUrl: updated.logoUrl, faviconUrl: updated.faviconUrl } : updated))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const handleRemoveLogo = async () => {
    setUploading(true)
    setError(null)
    try {
      const updated = await api.deleteBrandingLogo()
      setBranding((prev) => (prev ? { ...prev, logoUrl: null, faviconUrl: null } : updated))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const p = preview ?? branding.derived
  const displayName = name.trim() || 'Famlin'

  return (
    <>
      <p className="flex items-center gap-2 rounded-lg bg-background p-3 text-sm font-medium text-muted-foreground">
        <Eye className="size-4" />
        {t('branding.publicNote')}
      </p>
      <FormField label={t('branding.name')} hint={t('branding.nameHint')} htmlFor="branding-name">
        <Input
          id="branding-name"
          value={name}
          maxLength={NAME_MAX}
          placeholder="Famlin"
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <div>
        <span className="mb-2 block text-sm font-bold">{t('branding.color')}</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('branding.color')}>
          {branding.presets.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={preset === option.id}
              className={cn('rounded-full', preset === option.id && 'border-foreground ring-1 ring-foreground')}
              onClick={() => setPreset(option.id)}
              title={t(`branding.presets.${option.id}`, { defaultValue: option.id })}
            >
              <span className="size-5 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />
              {t(`branding.presets.${option.id}`, { defaultValue: option.id })}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            role="radio"
            aria-checked={preset === CUSTOM}
            className={cn('rounded-full', preset === CUSTOM && 'border-foreground ring-1 ring-foreground')}
            onClick={() => setPreset(CUSTOM)}
          >
            <span className="size-5 rounded-full bg-[conic-gradient(#e05a4c,#eeb154,#2f7a4b,#2459b8,#7b3f8c,#e05a4c)]" />
            {t('branding.custom')}
          </Button>
        </div>
      </div>
      {preset === CUSTOM && (
        <FormRow>
          <Input
            type="color"
            aria-label={t('branding.customColor')}
            className="h-10 w-12 cursor-pointer p-1"
            value={HEX_RE.test(customColor) ? withHash(customColor) : '#006e94'}
            onChange={(e) => setCustomColor(e.target.value)}
          />
          <FormField
            label={t('branding.customColor')}
            className="flex-1"
            error={!colorValid ? t('branding.invalidColor') : undefined}
            htmlFor="custom-color"
          >
            <Input
              id="custom-color"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value.trim())}
              placeholder="#006e94"
            />
          </FormField>
        </FormRow>
      )}
      {p.adjusted && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-5 rounded-full" style={{ backgroundColor: p.palette.primary }} />
          {t('branding.adjusted', { from: p.seed, to: p.palette.primary })}
        </p>
      )}
      {p.shifted.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('branding.shifted', { families: p.shifted.map((family) => t(`branding.families.${family}`)).join(', ') })}
        </p>
      )}
      <div>
        <span className="mb-2 block text-sm font-bold">{t('branding.logo')}</span>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {branding.logoUrl ? (
            <img className="size-12 rounded-lg border bg-card object-contain" src={branding.logoUrl} alt="" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-lg border text-muted-foreground">
              <Image className="size-5" />
            </span>
          )}
          <Input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => handleLogo(e.target.files?.[0])}
          />
          <Button type="button" variant="secondary" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading
              ? t('branding.uploading')
              : branding.logoUrl
                ? t('branding.replaceLogo')
                : t('branding.uploadLogo')}
          </Button>
          {branding.logoUrl && (
            <Button type="button" variant="secondary" disabled={uploading} onClick={handleRemoveLogo}>
              {t('branding.removeLogo')}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('branding.logoHint')}</p>
      </div>
      <div>
        <span className="mb-2 block text-sm font-bold">{t('branding.preview')}</span>
        <div
          className="flex flex-col gap-3 rounded-xl border p-4"
          style={{
            background:
              p.palette.loginBgFrom === p.palette.loginBgTo
                ? p.palette.bg
                : `linear-gradient(160deg, ${p.palette.loginBgFrom}, ${p.palette.loginBgTo})`,
          }}
        >
          <div className="flex items-center gap-2 text-lg">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="size-8 rounded-lg object-contain" />
            ) : (
              <span
                className="inline-block size-8 rounded-lg"
                style={{ background: `linear-gradient(150deg, ${p.palette.primaryLight}, ${p.palette.primaryDark})` }}
              />
            )}
            <strong style={{ color: p.palette.primary }}>{displayName}</strong>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm">
            <div className="flex flex-wrap gap-2">
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: p.palette.primaryTint, color: p.palette.primaryDark }}
              >
                {t('branding.families.family')}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: p.semantic.circleTint, color: p.semantic.circleDark }}
              >
                {t('branding.families.circle')}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: p.semantic.milestoneBg, color: p.semantic.milestoneText }}
              >
                {t('branding.families.milestone')}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: p.semantic.tripTint, color: p.semantic.tripDark }}
              >
                {t('branding.families.trip')}
              </span>
            </div>
            <span
              className="rounded-full px-4 py-2 text-sm font-bold text-white"
              style={{ background: p.palette.primary }}
            >
              {t('branding.previewButton')}
            </span>
          </div>
        </div>
      </div>
      <SaveBar
        actions={
          <Button type="button" disabled={saving || !dirty || !colorValid} onClick={handleSave}>
            {saving ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
          </Button>
        }
      >
        <span className={cn(error ? 'text-destructive' : saved ? 'text-success' : 'text-muted-foreground')}>
          {error ||
            (saved ? (
              <span className="flex items-center gap-1">
                <Check className="size-4" />
                {t('serverSettings.saved')}
              </span>
            ) : dirty ? (
              t('serverSettings.unsavedChanges')
            ) : (
              t('branding.appliesHint')
            ))}
        </span>
      </SaveBar>
    </>
  )
}
