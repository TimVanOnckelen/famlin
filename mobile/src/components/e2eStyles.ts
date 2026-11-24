import { Platform, StyleSheet } from 'react-native'
import { colors } from '@/constants/colors'

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

// Shared look of the encrypted-messages screens. Only imported by the lazily
// loaded authenticated screens, so `colors` already carries the branding.
export const e2eStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16, flexGrow: 1 },
  title: { fontFamily: 'Nunito_800ExtraBold', fontSize: 24, color: colors.textTitle },
  body: { fontFamily: 'Nunito_600SemiBold', fontSize: 16, lineHeight: 24, color: colors.textBody },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  center: { alignItems: 'center', gap: 16 },
  primaryButton: {
    paddingVertical: 15,
    borderRadius: 100,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  primaryButtonText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 16, color: colors.white },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: 100,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  secondaryButtonText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 15, color: colors.primary },
  linkButton: { paddingVertical: 12, alignItems: 'center' },
  linkButtonText: { fontFamily: 'Nunito_700Bold', fontSize: 15, color: colors.textMuted },
  disabled: { opacity: 0.45 },
  codeBox: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeText: {
    fontFamily: MONO,
    fontSize: 20,
    lineHeight: 32,
    letterSpacing: 1,
    textAlign: 'center',
    color: colors.textTitle,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary },
  checkLabel: { flex: 1, fontFamily: 'Nunito_700Bold', fontSize: 16, color: colors.textTitle },
  error: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.danger },
  input: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: MONO,
    fontSize: 18,
    color: colors.textTitle,
  },
})
