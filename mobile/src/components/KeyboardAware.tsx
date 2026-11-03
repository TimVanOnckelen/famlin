import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native'
import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context'

// Native iOS insets account for the scroll view's position inside pageSheet
// modals. Android keeps the height adjustment used by the existing forms.
export function KeyboardAwareScrollView(props: ScrollViewProps) {
  const scrollView = <ScrollView keyboardShouldPersistTaps="handled" {...props} automaticallyAdjustKeyboardInsets />
  if (Platform.OS === 'ios') return scrollView
  return (
    <KeyboardAvoidingView style={styles.flex} behavior="height">
      {scrollView}
    </KeyboardAvoidingView>
  )
}

// For non-scrollable screens, preserve their safe area while moving the
// complete overlay (including bottom controls) above the keyboard.
export function KeyboardAvoidingSafeAreaView({ style, pointerEvents, ...props }: SafeAreaViewProps) {
  return (
    <KeyboardAvoidingView
      style={style}
      pointerEvents={pointerEvents}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <SafeAreaView {...props} style={styles.flex} pointerEvents={pointerEvents} />
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({ flex: { flex: 1 } })
