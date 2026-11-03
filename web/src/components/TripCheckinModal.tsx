import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { checkInTrip, patchPostInCaches, uploadFiles } from '@famlin/api-client'
import { Icon } from './Icon'
import { useModalFocus } from '@/hooks/useModalFocus'
import { fileFormatLabel, isBrowserDecodableImage } from '@/utils/media'
import './NewPostModal.css'
import './TripCheckinModal.css'

const MAX_MEDIA = 10
interface Attachment {
  file: File
  url?: string
  id: number
}

export function TripCheckinModal({
  postId,
  tripTitle,
  dayNumber,
  onClose,
}: {
  postId: string
  tripTitle: string
  dayNumber: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const titleId = useId()
  const form = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const nextId = useRef(0)
  const [place, setPlace] = useState('')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const close = () => {
    if (!busy.current) onClose()
  }
  useModalFocus(form, close)

  const mutation = useMutation({
    mutationFn: async () => {
      const missing = attachments.filter((item) => !item.url)
      const urls = missing.length ? await uploadFiles(missing.map((item) => item.file)) : []
      if (urls.length !== missing.length) throw new Error(t('trip.checkin.alerts.failed'))
      const uploaded = new Map(missing.map((item, index) => [item.id, urls[index]]))
      const ready = attachments.map((item) => ({ ...item, url: item.url ?? uploaded.get(item.id)! }))
      // Keep uploaded paths after an interaction failure, so retry does not
      // upload the same files again. They are still private to the uploader.
      setAttachments(ready)
      return checkInTrip(postId, {
        place: place.trim(),
        text: text.trim() || undefined,
        photoUrls: ready.map((item) => item.url),
      })
    },
    onSuccess: (updated) => {
      patchPostInCaches(queryClient, postId, () => updated)
      void queryClient.invalidateQueries({ queryKey: ['posts'] })
      void queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      void queryClient.invalidateQueries({ queryKey: ['photos'] })
      onClose()
    },
    onSettled: () => {
      busy.current = false
    },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!place.trim() || busy.current) return
    busy.current = true
    mutation.mutate()
  }
  const message =
    isAxiosError(mutation.error) && typeof mutation.error.response?.data?.error === 'string'
      ? mutation.error.response.data.error
      : t('trip.checkin.alerts.failed')
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={close}>
      <form
        className="modal-card"
        ref={form}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="modal-title" id={titleId}>
          {t('trip.checkin.headerTitle')}
        </h2>
        <p className="field-hint">{t('trip.checkin.contextLine', { title: tripTitle, day: dayNumber })}</p>
        <fieldset className="trip-checkin-fields" disabled={mutation.isPending}>
          <label className="field">
            <span className="field-label">{t('trip.checkin.placeLabel')}</span>
            <input
              className="field-input"
              required
              value={place}
              maxLength={80}
              placeholder={t('trip.checkin.placePlaceholder')}
              onChange={(event) => setPlace(event.target.value)}
            />
          </label>
          <textarea
            className="modal-textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('trip.checkin.textPlaceholder')}
            aria-label={t('trip.checkin.textPlaceholder')}
            rows={3}
            maxLength={2000}
          />
          {attachments.length > 0 && (
            <div className="photo-previews">
              {attachments.map((item) => (
                <CheckinPreview
                  key={item.id}
                  file={item.file}
                  onRemove={() => setAttachments((current) => current.filter((other) => other.id !== item.id))}
                />
              ))}
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*,.heic,.heif,video/mp4,video/quicktime,video/webm"
            multiple
            hidden
            aria-label={t('trip.checkin.addPhotoLabel')}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? [])
              setAttachments((current) => [
                ...current,
                ...selected.slice(0, MAX_MEDIA - current.length).map((file) => ({ file, id: nextId.current++ })),
              ])
            }}
          />
          {attachments.length < MAX_MEDIA && (
            <div className="attach-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (input.current) input.current.value = ''
                  input.current?.click()
                }}
              >
                <Icon name="image" size={18} />
                {t('trip.checkin.addPhotoLabel')}
              </button>
            </div>
          )}
          <span className="field-hint">{t('trip.checkin.mediaLimit', { max: MAX_MEDIA })}</span>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!place.trim() || mutation.isPending}>
              {mutation.isPending ? t('common.loading') : t('trip.checkin.submitButton')}
            </button>
          </div>
        </fieldset>
        {mutation.isError && (
          <div role="alert" className="modal-error">
            {message}
          </div>
        )}
      </form>
    </div>
  )
}

function CheckinPreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <div className="photo-preview">
      {file.type.startsWith('video/') ? (
        <video src={preview} muted preload="metadata" aria-label={file.name} />
      ) : isBrowserDecodableImage(file) ? (
        <img src={preview || undefined} alt={file.name} />
      ) : (
        <span className="photo-preview-placeholder" title={file.name}>
          <Icon name="image" size={20} />
          <span className="photo-preview-format">{fileFormatLabel(file)}</span>
        </span>
      )}
      <button type="button" className="photo-preview-remove" aria-label={t('newPost.removePhoto')} onClick={onRemove}>
        <Icon name="x" size={14} strokeWidth={2.5} />
      </button>
    </div>
  )
}
