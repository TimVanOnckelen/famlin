import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { fetchGroupMembers } from '@famlin/api-client'
import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'

// Chips for choosing a gift list's participants from one family — shared by
// the composer (NewPostScreen) and the starter's editor on GiftListScreen.
// `selected` never contains the current user: the starter is always a
// participant and isn't offered as a chip. Mirrors web's
// GiftListParticipantPicker.
export function GiftListParticipantPicker({
  groupId,
  selfId,
  selected,
  onChange,
}: {
  groupId: string
  selfId: string
  selected: string[]
  onChange: (userIds: string[]) => void
}) {
  const { data } = useQuery({
    queryKey: ['group-members', groupId],
    queryFn: () => fetchGroupMembers(groupId),
    enabled: !!groupId,
  })
  const members = (data ?? []).filter((m) => m.id !== selfId)

  return (
    <View style={styles.chips}>
      {members.map((member) => {
        const active = selected.includes(member.id)
        return (
          <TouchableOpacity
            key={member.id}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(active ? selected.filter((id) => id !== member.id) : [...selected, member.id])}
          >
            <Avatar name={member.name} avatarUrl={member.avatarUrl} size={20} />
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{member.name}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  chipText: { fontFamily: 'Nunito_700Bold', fontSize: 13, color: colors.textBody },
  chipTextActive: { color: colors.primaryDark },
})
