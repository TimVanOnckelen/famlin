import { useTranslation } from 'react-i18next'
import { Post } from '@famlin/api-client'
import { AvatarStack } from '@/components/AvatarStack'
import { Badge } from '@/components/Badge'
import { Icon } from '@/components/Icon'
import { formatDayMonth } from '@/utils/time'
import '../PostCard.css'
import './GiftListFeedCard.css'

// The feed card for a GIFT_LIST post (issue #307): title, occasion date,
// participants, draw status and — once the names are drawn — who YOU are
// buying for. Everything else (wishlists, managing the list) lives on its own
// page (GiftListPage), opened from anywhere on the card. Only participants
// ever receive this post, so nothing here needs hiding. Mirrors mobile's
// GiftListCard.
export function GiftListFeedCard({
  post,
  showGroup = false,
  onOpenGiftList,
}: {
  post: Post
  showGroup?: boolean
  onOpenGiftList?: (postId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const giftList = post.giftList
  if (!giftList) return null

  return (
    <div className="post-card">
      <div className="post-card-inner gift-card-inner">
        <div className="post-body gift-card-body">
          <div className="gift-card-badge-row">
            <Badge variant="solid">
              <Icon name="gift" size={12} strokeWidth={2.2} />
              {t('giftList.badge')}
            </Badge>
            {showGroup && post.group && <span className="post-group-chip">{post.group.name}</span>}
          </div>
          <h3 className="gift-card-title">{giftList.title}</h3>
          <div className="gift-card-muted">
            {[
              giftList.occasionDate && formatDayMonth(giftList.occasionDate, i18n.language),
              t('giftList.participantCount', { count: giftList.participants.length }),
              giftList.budget && t('giftList.budgetValue', { budget: giftList.budget }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <AvatarStack people={giftList.participants} size={26} max={8} />

          {giftList.myRecipient ? (
            <div className="gift-card-recipient">
              <Icon name="gift" size={16} />
              <span>{t('giftList.buyingFor', { name: giftList.myRecipient.name })}</span>
            </div>
          ) : (
            giftList.drawEnabled && <div className="gift-card-muted">{t('giftList.drawPending')}</div>
          )}

          <div className="gift-card-actions">
            <button type="button" className="btn btn-primary" onClick={() => onOpenGiftList?.(post.id)}>
              {t('giftList.openCta')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
