import { useEffect, useMemo, useState } from 'react'
import { api, type ServerSettings } from '../../api/client'

export type SecretKey = 'oidcClientSecret' | 'smtpPass' | 'immichApiKey' | 'immichMirrorApiKey'
export type SecretDestination = 'oidcIssuer' | 'smtpHost' | 'immichServerUrl'

// The server settings as one editable form: Server settings and every
// integration's Connection tab edit the same Setting rows through
// PATCH /api/admin/settings, so they share this load/dirty/save cycle.
export function useSettingsForm() {
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  const [form, setForm] = useState<ServerSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s)
        setForm(s)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(false), 4000)
    return () => clearTimeout(timer)
  }, [success])

  const dirty = useMemo(() => settings !== null && JSON.stringify(form) !== JSON.stringify(settings), [form, settings])

  const updateField = <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSuccess(false)
  }

  // A saved secret never comes back from the server, so "has a value" is
  // either something typed now or a saved one that isn't marked for removal.
  const hasSecret = (key: SecretKey) => !!form && (Boolean(form[key]) || (form[key] !== null && form[`${key}Set`]))

  const discard = () => {
    if (settings) setForm(settings)
    setError(null)
    setSuccess(false)
  }

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const updated = await api.updateSettings(form)
      setSettings(updated)
      setForm(updated)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return { settings, form, loadError, saving, error, success, dirty, updateField, hasSecret, discard, save }
}

export type SettingsForm = ReturnType<typeof useSettingsForm>
