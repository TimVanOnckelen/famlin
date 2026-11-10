import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { DraftEvent } from '@/stores/postDraft'
import { validLocalInput } from '@/utils/event'

// True when the draft is complete enough to publish: a start, and an end and
// RSVP deadline that, when set, agree with it — the same rules the server
// enforces (errors.eventEndsBeforeStart, errors.eventDeadlineAfterStart).
// datetime-local values share one fixed format, so they compare as strings.
export function validEventDraft(event: DraftEvent): boolean {
  return (
    validLocalInput(event.startsAt) &&
    (!event.endsAt || (validLocalInput(event.endsAt) && event.endsAt >= event.startsAt)) &&
    (!event.rsvpDeadline || (validLocalInput(event.rsvpDeadline) && event.rsvpDeadline <= event.startsAt))
  )
}

// The event's title is the composer's main textarea (the post's content);
// these are the extra fields under it. Times are entered in the browser's
// local time zone.
export function EventComposerFields({
  event,
  setEvent,
}: {
  event: DraftEvent
  setEvent: Dispatch<SetStateAction<DraftEvent>>
}) {
  const { t } = useTranslation()
  const set = (key: keyof DraftEvent) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setEvent((previous) => ({ ...previous, [key]: value }))
  }
  return (
    <div className="event-composer-fields">
      <div className="event-composer-times">
        <label className="field">
          <span className="field-label">{t('newPost.event.startsAtLabel')} *</span>
          <input
            className="field-input"
            type="datetime-local"
            required
            value={event.startsAt}
            onChange={(e) => {
              const startsAt = e.target.value
              setEvent((previous) => ({
                ...previous,
                startsAt,
                endsAt: previous.endsAt && previous.endsAt < startsAt ? '' : previous.endsAt,
                rsvpDeadline: previous.rsvpDeadline && previous.rsvpDeadline > startsAt ? '' : previous.rsvpDeadline,
              }))
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('newPost.event.endsAtLabel')}</span>
          <input
            className="field-input"
            type="datetime-local"
            value={event.endsAt}
            min={event.startsAt || undefined}
            onChange={set('endsAt')}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">{t('newPost.event.locationLabel')}</span>
        <input
          className="field-input"
          value={event.location}
          maxLength={200}
          placeholder={t('newPost.event.locationPlaceholder')}
          onChange={set('location')}
        />
      </label>
      <label className="field">
        <span className="field-label">{t('newPost.event.rsvpDeadlineLabel')}</span>
        <span className="field-hint">{t('newPost.event.rsvpDeadlineHint')}</span>
        <input
          className="field-input"
          type="datetime-local"
          value={event.rsvpDeadline}
          max={event.startsAt || undefined}
          onChange={set('rsvpDeadline')}
        />
      </label>
    </div>
  )
}
