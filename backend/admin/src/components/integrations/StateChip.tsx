import { Badge } from '@famlin/ui/badge'
import { useTranslation } from 'react-i18next'
import type { IntegrationState } from '../../api/client'

const VARIANT = { ok: 'success', attention: 'milestone', failing: 'destructive', off: 'secondary' } as const

// An integration's state, or `children` as a custom label in that state's color.
export function StateChip({ state, children }: { state: IntegrationState; children?: React.ReactNode }) {
  const { t } = useTranslation()
  return <Badge variant={VARIANT[state]}>{children ?? t(`integrations.state.${state}`)}</Badge>
}
