import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, AdminBranding, DerivedBrand } from '../api/client';
import { Icon } from './Icon';

const CUSTOM = 'custom';
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const NAME_MAX = 40;

const withHash = (hex: string) => (hex.startsWith('#') ? hex : `#${hex}`).toLowerCase();

// Per-family branding (issue #164): preset or custom color, family name and
// logo. Has its own save (PUT /api/admin/branding) rather than joining the
// generic settings form, since the server validates and derives the palette.
export function BrandingSection() {
  const { t } = useTranslation();
  const [branding, setBranding] = useState<AdminBranding | null>(null);
  const [preset, setPreset] = useState('teal');
  const [customColor, setCustomColor] = useState('#006e94');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<DerivedBrand | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = (b: AdminBranding) => {
    setBranding(b);
    setPreset(b.preset);
    if (b.color) setCustomColor(b.color);
    setName(b.name);
    setPreview(b.derived);
  };

  useEffect(() => {
    api.getBranding().then(load).catch((err) => setError(err.message));
  }, []);

  const colorValid = preset !== CUSTOM || HEX_RE.test(customColor);

  // Live preview: the server derives the palette (one implementation for
  // every client), debounced so typing a hex doesn't fire a request per key.
  useEffect(() => {
    if (!branding || !colorValid) return;
    const timer = setTimeout(() => {
      api
        .previewBranding({ preset, color: preset === CUSTOM ? withHash(customColor) : null })
        .then(setPreview)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [branding, preset, customColor, colorValid]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!branding) return error ? <div className="error">{error}</div> : <div className="loading">{t('common.loading')}</div>;

  const dirty =
    preset !== branding.preset ||
    name.trim() !== branding.name ||
    (preset === CUSTOM && withHash(customColor) !== branding.color);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      load(
        await api.updateBranding({
          preset,
          color: preset === CUSTOM ? withHash(customColor) : null,
          name: name.trim(),
        })
      );
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await api.uploadBrandingLogo(file);
      setBranding((prev) => (prev ? { ...prev, logoUrl: updated.logoUrl, faviconUrl: updated.faviconUrl } : updated));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    setUploading(true);
    setError(null);
    try {
      const updated = await api.deleteBrandingLogo();
      setBranding((prev) => (prev ? { ...prev, logoUrl: null, faviconUrl: null } : updated));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const p = preview ?? branding.derived;
  const displayName = name.trim() || 'Famlin';

  return (
    <>
      <p className="branding-public-note">
        <Icon name="eye" size={14} /> {t('branding.publicNote')}
      </p>

      <label>
        {t('branding.name')}
        <input
          type="text"
          value={name}
          maxLength={NAME_MAX}
          placeholder="Famlin"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="hint">{t('branding.nameHint')}</p>

      <div>
        <span className="branding-label">{t('branding.color')}</span>
        <div className="branding-swatches" role="radiogroup" aria-label={t('branding.color')}>
          {branding.presets.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={preset === option.id}
              className={`branding-swatch${preset === option.id ? ' active' : ''}`}
              onClick={() => setPreset(option.id)}
              title={t(`branding.presets.${option.id}`, { defaultValue: option.id })}
            >
              <span className="branding-swatch-dot" style={{ background: option.color }} />
              <span className="branding-swatch-label">{t(`branding.presets.${option.id}`, { defaultValue: option.id })}</span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={preset === CUSTOM}
            className={`branding-swatch${preset === CUSTOM ? ' active' : ''}`}
            onClick={() => setPreset(CUSTOM)}
          >
            <span className="branding-swatch-dot branding-swatch-custom" />
            <span className="branding-swatch-label">{t('branding.custom')}</span>
          </button>
        </div>
      </div>

      {preset === CUSTOM && (
        <div className="row branding-custom-row">
          <input
            type="color"
            aria-label={t('branding.customColor')}
            value={HEX_RE.test(customColor) ? withHash(customColor) : '#006e94'}
            onChange={(e) => setCustomColor(e.target.value)}
          />
          <label style={{ flex: 1 }}>
            {t('branding.customColor')}
            <input type="text" value={customColor} onChange={(e) => setCustomColor(e.target.value.trim())} placeholder="#006e94" />
          </label>
        </div>
      )}
      {!colorValid && <p className="test-err">{t('branding.invalidColor')}</p>}

      {p.adjusted && (
        <p className="branding-notice">
          <span className="branding-swatch-dot" style={{ background: p.palette.primary }} />
          {t('branding.adjusted', { from: p.seed, to: p.palette.primary })}
        </p>
      )}
      {p.shifted.length > 0 && (
        <p className="branding-notice">
          {t('branding.shifted', {
            families: p.shifted.map((family) => t(`branding.families.${family}`)).join(', '),
          })}
        </p>
      )}

      <div>
        <span className="branding-label">{t('branding.logo')}</span>
        <div className="branding-logo-row">
          {branding.logoUrl ? (
            <img className="branding-logo" src={branding.logoUrl} alt="" />
          ) : (
            <span className="branding-logo branding-logo-empty">
              <Icon name="image" size={18} />
            </span>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => handleLogo(e.target.files?.[0])}
          />
          <button type="button" className="secondary" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? t('branding.uploading') : branding.logoUrl ? t('branding.replaceLogo') : t('branding.uploadLogo')}
          </button>
          {branding.logoUrl && (
            <button type="button" className="secondary" disabled={uploading} onClick={handleRemoveLogo}>
              {t('branding.removeLogo')}
            </button>
          )}
        </div>
        <p className="hint">{t('branding.logoHint')}</p>
      </div>

      <div>
        <span className="branding-label">{t('branding.preview')}</span>
        <div
          className="branding-preview"
          style={{
            background:
              p.palette.loginBgFrom === p.palette.loginBgTo
                ? p.palette.bg
                : `linear-gradient(160deg, ${p.palette.loginBgFrom}, ${p.palette.loginBgTo})`,
          }}
        >
          <div className="branding-preview-header">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="branding-preview-logo" />
            ) : (
              <span
                className="branding-preview-logo"
                style={{ background: `linear-gradient(150deg, ${p.palette.primaryLight}, ${p.palette.primaryDark})` }}
              />
            )}
            <strong style={{ color: p.palette.primary }}>{displayName}</strong>
          </div>
          <div className="branding-preview-card">
            <div className="branding-preview-chips">
              <span style={{ background: p.palette.primaryTint, color: p.palette.primaryDark }}>
                {t('branding.families.family')}
              </span>
              <span style={{ background: p.semantic.circleTint, color: p.semantic.circleDark }}>
                {t('branding.families.circle')}
              </span>
              <span style={{ background: p.semantic.milestoneBg, color: p.semantic.milestoneText }}>
                {t('branding.families.milestone')}
              </span>
              <span style={{ background: p.semantic.tripTint, color: p.semantic.tripDark }}>
                {t('branding.families.trip')}
              </span>
            </div>
            <span className="branding-preview-button" style={{ background: p.palette.primary }}>
              {t('branding.previewButton')}
            </span>
          </div>
        </div>
      </div>

      <div className="save-bar">
        <span className={`save-bar-msg${error ? ' err' : saved ? ' ok' : ''}`}>
          {error ? (
            error
          ) : saved ? (
            <>
              <Icon name="check" size={15} /> {t('serverSettings.saved')}
            </>
          ) : dirty ? (
            t('serverSettings.unsavedChanges')
          ) : (
            t('branding.appliesHint')
          )}
        </span>
        <div className="save-bar-actions">
          <button type="button" disabled={saving || !dirty || !colorValid} onClick={handleSave}>
            {saving ? t('serverSettings.saving') : t('serverSettings.saveSettings')}
          </button>
        </div>
      </div>
    </>
  );
}
