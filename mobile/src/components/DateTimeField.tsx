import React, { useState } from 'react'
import { Keyboard, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { useTranslation } from 'react-i18next'
import { getLocales } from 'expo-localization'
import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { parseLocalDateTime, toLocalDateTime } from '@/utils/event'

// A new value starts on the next whole hour, which is what most people pick
// for a get-together anyway.
function nextWholeHour(): Date {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return date
}

// DateField's date-and-time sibling. `value` is a local wall-clock string
// ('2026-11-14T15:00', see utils/event.ts) or '' when unset. Android has no
// combined picker, so it asks for the date and then the time; iOS shows one
// inline picker in a sheet and saves on Done.
export function DateTimeField({
  value,
  onChange,
  label,
  placeholder,
  clearLabel,
  minimum,
  maximum,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  // Set for an optional field: shows a clear button labelled with it.
  clearLabel?: string
  minimum?: string
  maximum?: string
}) {
  const { t } = useTranslation()
  const locale = getLocales()[0]?.languageTag
  const minimumDate = minimum ? parseLocalDateTime(minimum) : undefined
  const maximumDate = maximum ? parseLocalDateTime(maximum) : undefined
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(new Date())

  // Android's time dialog can't be bounded, so out-of-range picks are
  // dropped here, as DateField does for dates.
  function save(date: Date) {
    const formatted = toLocalDateTime(date)
    if ((minimum && formatted < minimum) || (maximum && formatted > maximum)) return
    onChange(formatted)
  }

  function initialDate(): Date {
    const date = value ? parseLocalDateTime(value) : nextWholeHour()
    if (minimumDate && date < minimumDate) return minimumDate
    if (maximumDate && date > maximumDate) return maximumDate
    return date
  }

  function showPicker() {
    Keyboard.dismiss()
    const date = initialDate()
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: date,
        mode: 'date',
        minimumDate,
        maximumDate,
        onValueChange: (_event, pickedDay) => {
          DateTimePickerAndroid.open({
            value: new Date(
              pickedDay.getFullYear(),
              pickedDay.getMonth(),
              pickedDay.getDate(),
              date.getHours(),
              date.getMinutes()
            ),
            mode: 'time',
            onValueChange: (_timeEvent, picked) => save(picked),
          })
        },
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
        <Icon name="calendar" size={16} color={value ? colors.primary : colors.textMuted} />
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1} adjustsFontSizeToFit>
          {value
            ? parseLocalDateTime(value).toLocaleString(locale, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : placeholder}
        </Text>
      </TouchableOpacity>
      {clearLabel && value ? (
        <TouchableOpacity
          style={styles.clear}
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
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
                    save(draft)
                    setOpen(false)
                  }}
                >
                  <Text style={styles.action}>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={draft}
                mode="datetime"
                display="inline"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
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
