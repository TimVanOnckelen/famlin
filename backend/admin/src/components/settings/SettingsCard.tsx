import { SectionCard } from '@famlin/ui/common/section-card'
import { Icon, type IconName } from '../Icon'

export function SettingsCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: IconName
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <SectionCard title={title} icon={<Icon name={icon} size={20} />} description={desc}>
      {children}
    </SectionCard>
  )
}
