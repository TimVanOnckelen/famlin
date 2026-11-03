import React, { useState } from 'react'
import { Keyboard, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useTranslation } from 'react-i18next'
import { getLocales } from 'expo-localization'
import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'

// Calendar dates are local dates, not UTC timestamps.
function parseDate(value: string): Date {
  if (!value) return new Date()
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function DateField({
  value,
  onChange,
  label,
  placeholder,
  optional = false,
  minimumDate,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  optional?: boolean
  minimumDate?: string
}) {
  const { t } = useTranslation()
  const locale = getLocales()[0]?.languageTag
  const minimum = minimumDate ? parseDate(minimumDate) : undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(new Date())

  function saveDate(date: Date) {
    const formatted = formatDate(date)
    if (!minimumDate || formatted >= minimumDate) onChange(formatted)
  }

  function showPicker() {
    Keyboard.dismiss()
    const selected = parseDate(value)
    const date = minimum && selected < minimum ? minimum : selected
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: date,
        mode: 'date',
        minimumDate: minimum,
        onValueChange: (_event, selected) => saveDate(selected),
      })
    } else {
      setDraft(date)
      setOpen(true)
    }
  }

  return (
    <View style={styles.field}>
      <TouchableOpacity
        style={styles.button}
        onPress={showPicker}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1} adjustsFontSizeToFit>
          {value
            ? parseDate(value).toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
            : placeholder}
        </Text>
      </TouchableOpacity>
      {optional && value ? (
        <TouchableOpacity
          style={styles.clear}
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel={t('newPost.trip.clearEndDate')}
        >
          <Icon name="x" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => setOpen(false)}>
                  <Text style={styles.action}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    saveDate(draft)
                    setOpen(false)
                  }}
                >
                  <Text style={styles.action}>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={draft}
                mode="date"
                display="inline"
                minimumDate={minimum}
                onValueChange={(_event, date) => setDraft(date)}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
  },
  button: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 12 },
  value: { flex: 1, fontFamily: 'Nunito_600SemiBold', fontSize: 16, color: colors.textTitle },
  placeholder: { color: colors.textMuted },
  clear: { padding: 10 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  action: { color: colors.primary, fontFamily: 'Nunito_700Bold', fontSize: 16, paddingVertical: 8 },
})
