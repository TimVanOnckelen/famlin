import { SectionCard } from '@famlin/ui/common/section-card'
import { SettingToggle } from '@famlin/ui/common/setting-toggle'
import { Icon, type IconName } from '../Icon'

export function SettingsCard({
  icon,
  title,
  desc,
  badge,
  children,
}: {
  icon: IconName
  title: string
  desc?: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <SectionCard title={title} icon={<Icon name={icon} size={20} />} description={desc} badge={badge}>
      {children}
    </SectionCard>
  )
}

export function ToggleRow({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return <SettingToggle title={title} hint={hint} checked={checked} onCheckedChange={onChange} />
}
