import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  chatConversationsQueryKey,
  chatPeopleQueryKey,
  createChatConversation,
  fetchChatPeople,
} from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { Icon } from '@/components/Icon'
import { ScreenHeader } from '@/components/ScreenHeader'
import { useAuthStore } from '@/stores/authStore'
import { useDirectMessagePolicy } from '@/hooks/useServerInfo'
import { eligibleChatPeople } from '@/utils/chatConversations'

export function DmMemberPickerScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const [search, setSearch] = useState('')
  const dmPolicy = useDirectMessagePolicy()
  useEffect(() => {
    if (dmPolicy.disabledByAdmin) navigation.replace('ChatInbox')
  }, [dmPolicy.disabledByAdmin, navigation])
  const peopleQuery = useQuery({ queryKey: chatPeopleQueryKey(), queryFn: fetchChatPeople })
  const people = useMemo(
    () => eligibleChatPeople(peopleQuery.data?.items ?? [], userId, search),
    [peopleQuery.data?.items, search, userId]
  )

  const createMutation = useMutation({
    mutationFn: (participantId: string) => createChatConversation({ kind: 'PRIVATE', participantIds: [participantId] }),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: chatConversationsQueryKey() })
      navigation.navigate('DirectMessage', { conversationId: conversation.id })
    },
    onError: (error: any) => {
      Alert.alert(t('common.error'), error.response?.data?.error || error.message || t('chat.peopleError'))
    },
  })

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('chat.choosePerson')} onBack={() => navigation.goBack()} centered />
      <View style={styles.searchRow}>
        <Icon name="search" size={17} color={colors.textMuted} />
        <TextInput
          accessibilityLabel={t('chat.searchPeople')}
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('chat.searchPeople')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
        />
      </View>

      {peopleQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.person}
              disabled={createMutation.isPending}
              onPress={() => createMutation.mutate(item.id)}
              accessibilityLabel={item.name}
            >
              <Avatar name={item.name} avatarUrl={item.avatarUrl} size={44} />
              <Text style={styles.name}>{item.name}</Text>
              {createMutation.isPending && createMutation.variables === item.id ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Icon name="chevron-right" size={18} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <EmptyState
              title={t(peopleQuery.isError ? 'chat.peopleError' : search ? 'chat.peopleNoMatch' : 'chat.peopleEmpty')}
              subtitle={peopleQuery.isError ? t('chat.peopleErrorSubtitle') : undefined}
              centerSubtitle
            />
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  searchInput: { flex: 1, height: 44, color: colors.textBody, fontFamily: 'Nunito_400Regular', fontSize: 15 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 10, flexGrow: 1 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  name: { flex: 1, color: colors.textTitle, fontFamily: 'Nunito_700Bold', fontSize: 16 },
})
