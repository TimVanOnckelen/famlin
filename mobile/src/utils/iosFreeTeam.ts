import { Platform } from 'react-native'
import Constants from 'expo-constants'

/**
 * Whether this is a local iOS build made with FAMLIN_IOS_FREE_TEAM=1 (see
 * app.config.js and docs/developers/quick-start.md): signed with a free
 * Apple account, so it has no push, Sign in with Apple or App Group
 * entitlement. Never true in a store/EAS build, nor on Android.
 */
export function isIosFreeTeamBuild(): boolean {
  return Platform.OS === 'ios' && Constants.expoConfig?.extra?.iosFreeTeam === true
}
