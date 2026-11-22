import type { TextStyle, ViewStyle } from 'react-native'
import { colors } from '@/constants/colors'

// Styles shared by ProfileScreen and the profile sections split out of it
// (e.g. CalendarFeedSection), so a section card looks the same wherever it's
// rendered. Plain objects, spread into each file's own StyleSheet.create().
// Only imported from the lazily loaded authenticated screens, so `colors`
// already carries the server's branding when this module is evaluated.
export const profileSectionStyles = {
  section: {
    backgroundColor: colors.white,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  } satisfies ViewStyle,
  sectionTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 14,
  } satisfies TextStyle,
  sectionDescription: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    lineHeight: 19,
    color: colors.textBody,
    marginBottom: 12,
  } satisfies TextStyle,
  outlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  } satisfies ViewStyle,
  outlineButtonText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: colors.primary,
  } satisfies TextStyle,
}
