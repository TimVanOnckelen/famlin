import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AdminModal } from './AdminModal'
import { useTranslation } from 'react-i18next'

type PasswordOptions = { onSubmit: (password: string) => Promise<void> }
type Request = {
  id: number
  kind: 'confirm' | 'message' | 'password'
  message: string
  options?: PasswordOptions
  resolve: (value: boolean) => void
}
type Dialogs = {
  confirmAction: (message: string) => Promise<boolean>
  showMessage: (message: string) => Promise<void>
  requestPassword: (message: string, options: PasswordOptions) => Promise<boolean>
}
const DialogContext = createContext<Dialogs | null>(null)
let nextId = 0

export function AdminDialogProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<Request[]>([])
  const pending = useRef(new Map<number, Request>())
  useEffect(
    () => () => {
      for (const request of pending.current.values()) request.resolve(false)
      pending.current.clear()
    },
    []
  )

  const enqueue = useCallback(
    (kind: Request['kind'], message: string, options?: PasswordOptions) =>
      new Promise<boolean>((resolve) => {
        const request = { id: ++nextId, kind, message, options, resolve }
        pending.current.set(request.id, request)
        setRequests((current) => [...current, request])
      }),
    []
  )
  const dialogs = useMemo<Dialogs>(
    () => ({
      confirmAction: (message) => enqueue('confirm', message),
      showMessage: async (message) => {
        await enqueue('message', message)
      },
      requestPassword: (message, options) => enqueue('password', message, options),
    }),
    [enqueue]
  )
  const finish = useCallback((request: Request, result: boolean) => {
    if (!pending.current.delete(request.id)) return
    setRequests((current) => current.filter((item) => item.id !== request.id))
    request.resolve(result)
  }, [])
  const current = requests[0]
  return (
    <DialogContext.Provider value={dialogs}>
      {children}
      {current && <AdminDialog key={current.id} request={current} onFinish={finish} />}
    </DialogContext.Provider>
  )
}

export function useAdminDialogs() {
  const dialogs = useContext(DialogContext)
  if (!dialogs) throw new Error('AdminDialogProvider is required')
  return dialogs
}

function AdminDialog({
  request,
  onFinish,
}: {
  request: Request
  onFinish: (request: Request, result: boolean) => void
}) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const isPassword = request.kind === 'password'
  const title = t(
    isPassword ? 'common.changePassword' : request.kind === 'confirm' ? 'common.confirmTitle' : 'common.messageTitle'
  )

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!isPassword) return onFinish(request, true)
    if (password.length < 8) {
      setError(t('users.passwordTooShort'))
      return
    }
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      await request.options!.onSubmit(password)
      onFinish(request, true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <AdminModal
      title={title}
      descriptionId="admin-dialog-message"
      initialFocusSelector="[data-initial-focus]"
      busy={saving}
      onClose={() => {
        if (!submitting.current) onFinish(request, false)
      }}
    >
      <p id="admin-dialog-message" className="admin-dialog-message">
        {request.message}
      </p>
      <form onSubmit={submit} noValidate aria-busy={saving}>
        {isPassword && (
          <label>
            {t('common.password')}
            <input
              data-initial-focus
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
              }}
              minLength={8}
              autoComplete="new-password"
              disabled={saving}
              aria-invalid={!!error}
              aria-describedby={error ? 'admin-dialog-error' : undefined}
            />
          </label>
        )}
        {error && (
          <div id="admin-dialog-error" className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          {request.kind !== 'message' && (
            <button
              data-initial-focus={isPassword ? undefined : true}
              type="button"
              className="secondary"
              disabled={saving}
              onClick={() => onFinish(request, false)}
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            className={request.kind === 'confirm' ? 'danger' : undefined}
            data-initial-focus={request.kind === 'message' ? true : undefined}
            type="submit"
            disabled={saving}
          >
            {t(
              saving
                ? 'common.loading'
                : isPassword
                  ? 'common.save'
                  : request.kind === 'confirm'
                    ? 'common.confirm'
                    : 'common.done'
            )}
          </button>
        </div>
      </form>
    </AdminModal>
  )
}
