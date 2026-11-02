import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupMember } from '@famlin/api-client'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { fileFormatLabel, isBrowserDecodableImage } from '@/utils/media'

export interface TripDraft {
  title: string
  destination: string
  startDate: string
  endDate: string
  cover: File | null
  travelerIds: string[]
}

export function TripComposerFields({
  trip,
  setTrip,
  members,
  loaded,
  isError,
  retry,
  selfId,
}: {
  trip: TripDraft
  setTrip: Dispatch<SetStateAction<TripDraft>>
  members: GroupMember[]
  loaded: boolean
  isError: boolean
  retry: () => void
  selfId: string
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState('')
  const coverInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!trip.cover) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(trip.cover)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [trip.cover])
  return (
    <div className="trip-composer-fields">
      <p className="field-hint">{t('newPost.trip.helper')}</p>
      <label className="field">
        <span className="field-label">{t('newPost.trip.titleLabel')} *</span>
        <input
          className="field-input"
          value={trip.title}
          required
          maxLength={120}
          placeholder={t('newPost.trip.titlePlaceholder')}
          onChange={(e) => setTrip((previous) => ({ ...previous, title: e.target.value }))}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('newPost.trip.destinationLabel')}</span>
        <input
          className="field-input"
          value={trip.destination}
          maxLength={160}
          placeholder={t('newPost.trip.destinationPlaceholder')}
          onChange={(e) => setTrip((previous) => ({ ...previous, destination: e.target.value }))}
        />
      </label>
      <div className="trip-composer-dates">
        <label className="field">
          <span className="field-label">{t('newPost.trip.startDateLabel')} *</span>
          <input
            className="field-input"
            type="date"
            required
            value={trip.startDate}
            onChange={(e) => {
              const startDate = e.target.value
              setTrip((previous) => ({
                ...previous,
                startDate,
                endDate: previous.endDate && previous.endDate < startDate ? '' : previous.endDate,
              }))
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('newPost.trip.endDateLabel')}</span>
          <input
            className="field-input"
            type="date"
            value={trip.endDate}
            min={trip.startDate || undefined}
            onChange={(e) => setTrip((previous) => ({ ...previous, endDate: e.target.value }))}
          />
        </label>
      </div>
      <div className="field">
        <span className="field-label">{t('newPost.trip.coverPhotoTitle')}</span>
        <input
          ref={coverInput}
          type="file"
          hidden
          aria-label={t('newPost.trip.coverPhotoTitle')}
          accept="image/*,.heic,.heif"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (
              !trip.cover &&
              file &&
              (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name))
            )
              setTrip((previous) => (previous.cover ? previous : { ...previous, cover: file }))
          }}
        />
        {trip.cover ? (
          <div className="photo-previews">
            <div className="photo-preview">
              {preview && isBrowserDecodableImage(trip.cover) ? (
                <img src={preview} alt={trip.cover.name} />
              ) : (
                <span className="photo-preview-placeholder" title={trip.cover.name}>
                  <Icon name="image" size={20} />
                  <span className="photo-preview-format">{fileFormatLabel(trip.cover)}</span>
                </span>
              )}
              <button
                type="button"
                className="photo-preview-remove"
                aria-label={t('newPost.removePhoto')}
                onClick={() => setTrip((previous) => ({ ...previous, cover: null }))}
              >
                <Icon name="x" size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : (
          <div className="attach-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (coverInput.current) coverInput.current.value = ''
                coverInput.current?.click()
              }}
            >
              <Icon name="image" size={18} />
              {t('newPost.addPhotos')}
            </button>
          </div>
        )}
      </div>
      <fieldset className="trip-companions">
        <legend className="field-label">{t('newPost.trip.travelersLabel')}</legend>
        <p className="field-hint">{t('newPost.trip.travelersSubtitle')}</p>
        {isError ? (
          <div role="alert">
            <p>{t('newPost.trip.membersFailed')}</p>
            <button type="button" className="btn btn-secondary" onClick={retry}>
              {t('newPost.trip.retry')}
            </button>
          </div>
        ) : !loaded ? (
          <p role="status">{t('common.loading')}</p>
        ) : (
          <>
            <div className="group-select-chips">
              {members
                .filter((member) => member.id !== selfId)
                .map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className={`filter-chip${trip.travelerIds.includes(member.id) ? ' filter-chip-active' : ''}`}
                    aria-pressed={trip.travelerIds.includes(member.id)}
                    disabled={!trip.travelerIds.includes(member.id) && trip.travelerIds.length >= 20}
                    onClick={() =>
                      setTrip((previous) => ({
                        ...previous,
                        travelerIds: previous.travelerIds.includes(member.id)
                          ? previous.travelerIds.filter((id) => id !== member.id)
                          : [...previous.travelerIds, member.id],
                      }))
                    }
                  >
                    <Avatar name={member.name} avatarUrl={member.avatarUrl} size={24} /> {member.name}
                  </button>
                ))}
            </div>
            {!members.some((member) => member.id !== selfId) && (
              <p className="field-hint">{t('newPost.trip.noCompanions')}</p>
            )}
          </>
        )}
      </fieldset>
    </div>
  )
}

export function validTripDate(value: string): boolean {
  const date = Date.parse(`${value}T00:00:00Z`)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value
  )
}
