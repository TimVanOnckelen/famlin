import { useTranslation } from 'react-i18next'
import type { IntegrationState } from '../../api/client'

export function StateChip({ state }: { state: IntegrationState }) {
  const { t } = useTranslation()
  return <span className={`integration-chip ${state}`}>{t(`integrations.state.${state}`)}</span>
}
