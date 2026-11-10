import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Post, RSVP_RESPONSES, RsvpResponse, rsvpEvent, patchPostInCaches } from '@famlin/api-client'
import { AvatarStack } from '@/components/AvatarStack'
import { Icon } from '@/components/Icon'
import { formatEventDeadline, formatEventWhen } from '@/utils/event'
import '../PostCard.css'

export function EventCardBody({ post }: { post: Post }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const event = post.event

  // Like votePoll, rsvpEvent returns the full shaped + enriched post, so the
  // server's answer goes straight into every cache holding this post.
  const rsvpMutation = useMutation({
    mutationFn: (response: RsvpResponse) => rsvpEvent(post.id, response),
    onSuccess: (updatedPost) => {
      patchPostInCaches(queryClient, post.id, () => updatedPost)
    },
  })

  if (!event) return null

  const disabled = event.closed || rsvpMutation.isPending

  return (
    <div className="event-body">
      <div className="event-details">
        <span className="event-detail">
          <Icon name="calendar" size={16} />
          <span>{formatEventWhen(event.startsAt, event.endsAt, i18n.language)}</span>
        </span>
        {event.location && (
          <span className="event-detail">
            <Icon name="map-pin" size={16} />
            <span>{event.location}</span>
          </span>
        )}
        {event.rsvpDeadline && !event.closed && (
          <span className="event-detail event-detail-muted">
            <Icon name="clock" size={16} />
            <span>{t('event.rsvpBy', { date: formatEventDeadline(event.rsvpDeadline, i18n.language) })}</span>
          </span>
        )}
      </div>

      <div className="event-rsvp" role="group" aria-label={t('event.rsvpLabel')}>
        {RSVP_RESPONSES.map((response) => {
          const isMine = event.myRsvp === response
          return (
            <button
              key={response}
              type="button"
              className={`event-rsvp-option${isMine ? ' event-rsvp-option-mine' : ''}`}
              onClick={() => rsvpMutation.mutate(response)}
              disabled={disabled}
              aria-pressed={isMine}
            >
              {isMine && <Icon name="check" size={14} strokeWidth={3} />}
              <span>{t(`event.${response}`)}</span>
              <span className="event-rsvp-count">{event.counts[response]}</span>
            </button>
          )
        })}
      </div>

      {RSVP_RESPONSES.some((response) => event.responses[response].length > 0) && (
        <div className="event-guests">
          {RSVP_RESPONSES.map(
            (response) =>
              event.responses[response].length > 0 && (
                <div key={response} className="event-guest-row">
                  <span className="event-guest-label">{t(`event.${response}`)}</span>
                  <AvatarStack people={event.responses[response]} size={22} max={8} />
                  <span className="event-guest-names">
                    {event.responses[response].map((person) => person.name).join(', ')}
                  </span>
                </div>
              )
          )}
        </div>
      )}

      {rsvpMutation.isError && (
        <div className="event-error" role="alert">
          {t('event.rsvpFailed')}
        </div>
      )}
      {event.closed && (
        <div className="poll-footer">
          <span className="poll-closed-label">{t('event.closed')}</span>
        </div>
      )}
    </div>
  )
}
