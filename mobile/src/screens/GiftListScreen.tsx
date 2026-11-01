import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import {
  createGiftListItem,
  deleteGiftListItem,
  deletePost,
  drawGiftList,
  fetchGiftListItems,
  fetchPost,
  isGiftDrawResetConflict,
  leaveGiftList,
  reorderGiftListItems,
  setGiftListParticipants,
  updateGiftListItem,
  updateGiftListSettings,
} from '@famlin/api-client'
import type { GiftListItem, GiftListItemBody, GiftListSettingsBody, Post } from '@/types'
import { colors } from '@/constants/colors'
import { Icon } from '@/components/Icon'
import { Avatar } from '@/components/Avatar'
import { MediaThumbnail } from '@/components/MediaThumbnail'
import { ScreenHeader } from '@/components/ScreenHeader'
import { GiftListParticipantPicker } from '@/components/GiftListParticipantPicker'
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia'
import { getUploadUrl } from '@/api/uploads'
import { useAuthStore } from '@/stores/authStore'
import { formatDayMonth, isValidShopUrl } from '@/utils/giftList'

// A gift list (issue #307): every participant's wishlist, your own editable,
// plus — for the starter — participants, settings and the Secret Santa draw.
// Full parity with web's GiftListPage.
export function GiftListScreen() {
  const { t, i18n } = useTranslation()
  const navigation = useNavigation<any>()
  const { postId } = useRoute<any>().params as { postId: string }
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [managing, setManaging] = useState(false)

  const { data: post } = useQuery({ queryKey: ['post', postId], queryFn: () => fetchPost(postId) })
  const { data: items = [] } = useQuery({
    queryKey: ['gift-list-items', postId],
    queryFn: () => fetchGiftListItems(postId),
  })

  function refresh(updated?: Post) {
    if (updated) queryClient.setQueryData(['post', postId], updated)
    else queryClient.invalidateQueries({ queryKey: ['post', postId] })
    queryClient.invalidateQueries({ queryKey: ['gift-list-items', postId] })
    queryClient.invalidateQueries({ queryKey: ['posts'] })
    queryClient.invalidateQueries({ queryKey: ['gift-lists'] })
  }

  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onError: (err: any) => Alert.alert(t('common.error'), err.response?.data?.error || t('giftList.actionFailed')),
  })

  // A starter change that would discard the draw comes back 409: ask, then
  // resend with confirmRedraw.
  function withRedrawConfirm(run: (confirmRedraw: boolean) => Promise<Post>) {
    action.mutate(async () => {
      try {
        refresh(await run(false))
      } catch (err) {
        if (!isGiftDrawResetConflict(err)) throw err
        Alert.alert(t('giftList.redrawConfirm'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('giftList.drawCta'), onPress: () => action.mutate(async () => refresh(await run(true))) },
        ])
      }
    })
  }

  function confirmThen(message: string, run: () => Promise<unknown>) {
    Alert.alert(message, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.done'), style: 'destructive', onPress: () => action.mutate(run) },
    ])
  }

  const giftList = post?.giftList
  if (!post || !giftList || !user) return null

  const recipient = giftList.myRecipient
  const rank = (id: string) => (id === user.id ? 0 : id === recipient?.id ? 1 : 2)
  const participants = [...giftList.participants].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name)
  )
  const meta = [
    giftList.occasionDate && formatDayMonth(giftList.occasionDate, i18n.language),
    giftList.budget && t('giftList.budgetValue', { budget: giftList.budget }),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('giftList.headerTitle')} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <View style={styles.badge}>
              <Icon name="gift" size={11} color={colors.white} />
              <Text style={styles.badgeText}>{t('giftList.badge')}</Text>
            </View>
            <Text style={styles.title}>{giftList.title}</Text>
            {!!meta && <Text style={styles.muted}>{meta}</Text>}
            {!!post.content && <Text style={styles.body}>{post.content}</Text>}
            {recipient ? (
              <View style={styles.recipient}>
                <Avatar name={recipient.name} avatarUrl={recipient.avatarUrl} size={34} />
                <Text style={styles.recipientText}>{t('giftList.buyingFor', { name: recipient.name })}</Text>
              </View>
            ) : (
              giftList.drawEnabled && <Text style={styles.muted}>{t('giftList.drawPending')}</Text>
            )}
            <View style={styles.row}>
              {giftList.isManager ? (
                <>
                  {giftList.drawEnabled && !giftList.drawn && (
                    <Button
                      primary
                      label={t('giftList.drawCta')}
                      disabled={action.isPending || giftList.participants.length < 3}
                      onPress={() => action.mutate(async () => refresh(await drawGiftList(postId)))}
                    />
                  )}
                  <Button label={t('giftList.manageCta')} onPress={() => setManaging((v) => !v)} />
                  <Button
                    label={t('giftList.deleteCta')}
                    onPress={() =>
                      confirmThen(t('giftList.deleteConfirm'), async () => {
                        await deletePost(postId)
                        refresh()
                        navigation.goBack()
                      })
                    }
                  />
                </>
              ) : (
                <Button
                  label={t('giftList.leaveCta')}
                  onPress={() =>
                    confirmThen(t('giftList.leaveConfirm'), async () => {
                      await leaveGiftList(postId)
                      refresh()
                      navigation.goBack()
                    })
                  }
                />
              )}
            </View>
            {giftList.isManager && giftList.drawEnabled && !giftList.drawn && giftList.participants.length < 3 && (
              <Text style={styles.muted}>{t('giftList.drawNeedsThree')}</Text>
            )}
          </View>

          {giftList.isManager && managing && (
            <ManagePanel
              post={post}
              selfId={user.id}
              busy={action.isPending}
              onSaveSettings={(body) =>
                withRedrawConfirm((confirmRedraw) => updateGiftListSettings(postId, { ...body, confirmRedraw }))
              }
              onSaveParticipants={(userIds) =>
                withRedrawConfirm((confirmRedraw) => setGiftListParticipants(postId, userIds, confirmRedraw))
              }
            />
          )}

          {participants.map((p) => (
            <Wishlist
              key={p.id}
              postId={postId}
              participant={p}
              isMine={p.id === user.id}
              isRecipient={p.id === recipient?.id}
              items={items.filter((item) => item.ownerId === p.id)}
              onChanged={() => refresh()}
            />
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Button({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.button, primary && styles.buttonPrimary, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </TouchableOpacity>
  )
}

function Wishlist({
  postId,
  participant,
  isMine,
  isRecipient,
  items,
  onChanged,
}: {
  postId: string
  participant: { id: string; name: string; avatarUrl: string | null }
  isMine: boolean
  isRecipient: boolean
  items: GiftListItem[]
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const mutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      setEditing(null)
      onChanged()
    },
    onError: (err: any) => Alert.alert(t('common.error'), err.response?.data?.error || t('giftList.actionFailed')),
  })

  function move(index: number, delta: number) {
    const ids = items.map((i) => i.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + delta, 0, moved)
    mutation.mutate(() => reorderGiftListItems(postId, ids))
  }

  return (
    <View style={[styles.section, isRecipient && styles.recipientSection]}>
      <View style={styles.wishlistHeader}>
        <Avatar name={participant.name} avatarUrl={participant.avatarUrl} size={30} />
        <Text style={styles.wishlistTitle}>
          {isMine ? t('giftList.myWishlist') : t('giftList.wishlistOf', { name: participant.name })}
        </Text>
      </View>
      {isRecipient && <Text style={styles.recipientTag}>{t('giftList.recipientBadge')}</Text>}

      {items.length === 0 && editing !== 'new' && (
        <Text style={styles.muted}>{isMine ? t('giftList.myWishlistEmpty') : t('giftList.wishlistEmpty')}</Text>
      )}

      {items.map((item, index) =>
        editing === item.id ? (
          <ItemForm
            key={item.id}
            initial={item}
            busy={mutation.isPending}
            onCancel={() => setEditing(null)}
            onSave={(body) => mutation.mutate(() => updateGiftListItem(postId, item.id, body))}
          />
        ) : (
          <View key={item.id} style={styles.item}>
            {item.photoUrl && (
              <MediaThumbnail url={getUploadUrl(item.photoUrl, 'thumbnail')} style={styles.itemPhoto} />
            )}
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {!!item.note && <Text style={styles.muted}>{item.note}</Text>}
              {!!item.url && (
                <Text style={styles.link} numberOfLines={1} onPress={() => Linking.openURL(item.url!)}>
                  {item.url}
                </Text>
              )}
            </View>
            {isMine && (
              <View style={styles.itemActions}>
                <IconButton
                  name="chevron-up"
                  disabled={index === 0}
                  onPress={() => move(index, -1)}
                  label={t('giftList.moveUp')}
                />
                <IconButton
                  name="chevron-down"
                  disabled={index === items.length - 1}
                  onPress={() => move(index, 1)}
                  label={t('giftList.moveDown')}
                />
                <IconButton name="edit-2" onPress={() => setEditing(item.id)} label={t('giftList.editItem')} />
                <IconButton
                  name="trash-2"
                  label={t('giftList.deleteItem')}
                  onPress={() =>
                    Alert.alert(t('giftList.deleteItemConfirm'), undefined, [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('giftList.deleteItem'),
                        style: 'destructive',
                        onPress: () => mutation.mutate(() => deleteGiftListItem(postId, item.id)),
                      },
                    ])
                  }
                />
              </View>
            )}
          </View>
        )
      )}

      {isMine &&
        (editing === 'new' ? (
          <ItemForm
            busy={mutation.isPending}
            onCancel={() => setEditing(null)}
            onSave={(body) => mutation.mutate(() => createGiftListItem(postId, body as GiftListItemBody))}
          />
        ) : (
          <Button label={t('giftList.addItem')} onPress={() => setEditing('new')} />
        ))}
    </View>
  )
}

function IconButton({
  name,
  onPress,
  label,
  disabled = false,
}: {
  name: string
  onPress: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[styles.iconButton, disabled && styles.disabled]}
    >
      <Icon name={name as any} size={16} color={colors.textMuted} />
    </TouchableOpacity>
  )
}

function ItemForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: GiftListItem
  busy: boolean
  onSave: (body: Partial<GiftListItemBody>) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [photoUrl, setPhotoUrl] = useState<string | null>(initial?.photoUrl ?? null)
  const { pick, uploading } = usePickAndUploadMedia({
    pickerOptions: { mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: false, quality: 0.8 },
  })
  const urlValid = isValidShopUrl(url)

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={t('giftList.itemTitlePlaceholder')}
        maxLength={200}
        autoFocus
      />
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder={t('giftList.itemNotePlaceholder')}
        maxLength={1000}
      />
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder={t('giftList.itemUrlPlaceholder')}
        autoCapitalize="none"
        keyboardType="url"
        maxLength={2000}
      />
      {!urlValid && <Text style={styles.error}>{t('giftList.itemUrlInvalid')}</Text>}
      <View style={styles.row}>
        {photoUrl && <MediaThumbnail url={getUploadUrl(photoUrl, 'thumbnail')} style={styles.itemPhoto} />}
        <Button
          label={uploading ? t('common.loading') : photoUrl ? t('giftList.changePhoto') : t('giftList.addPhoto')}
          disabled={uploading}
          onPress={async () => {
            const result = await pick()
            if (result?.urls[0]) setPhotoUrl(result.urls[0])
          }}
        />
        {photoUrl && <Button label={t('giftList.removePhoto')} onPress={() => setPhotoUrl(null)} />}
      </View>
      <View style={styles.row}>
        <Button label={t('common.cancel')} onPress={onCancel} />
        <Button
          primary
          label={t('common.save')}
          disabled={busy || uploading || !title.trim() || !urlValid}
          onPress={() => onSave({ title: title.trim(), note: note.trim() || null, url: url.trim() || null, photoUrl })}
        />
      </View>
    </View>
  )
}

// The starter's panel: participants, title/date/budget, the draw toggle and
// exclusions (tap two people to pair them).
function ManagePanel({
  post,
  selfId,
  busy,
  onSaveSettings,
  onSaveParticipants,
}: {
  post: Post
  selfId: string
  busy: boolean
  onSaveSettings: (body: GiftListSettingsBody) => void
  onSaveParticipants: (userIds: string[]) => void
}) {
  const { t } = useTranslation()
  const giftList = post.giftList!
  const [participantIds, setParticipantIds] = useState(
    giftList.participants.map((p) => p.id).filter((id) => id !== selfId)
  )
  const [title, setTitle] = useState(giftList.title)
  const [occasionDate, setOccasionDate] = useState(giftList.occasionDate ?? '')
  const [budget, setBudget] = useState(giftList.budget ?? '')
  const [drawEnabled, setDrawEnabled] = useState(giftList.drawEnabled)
  const [exclusions, setExclusions] = useState<Array<[string, string]>>(giftList.exclusions ?? [])
  const [pairStart, setPairStart] = useState<string | null>(null)
  const nameOf = (id: string) => giftList.participants.find((p) => p.id === id)?.name ?? '?'
  const dateValid = !occasionDate || /^\d{4}-\d{2}-\d{2}$/.test(occasionDate)

  function tapPerson(id: string) {
    if (!pairStart) return setPairStart(id)
    if (pairStart !== id) setExclusions([...exclusions, [pairStart, id]])
    setPairStart(null)
  }

  return (
    <View style={styles.section}>
      <Text style={styles.wishlistTitle}>{t('giftList.participants')}</Text>
      <GiftListParticipantPicker
        groupId={post.groupId}
        selfId={selfId}
        selected={participantIds}
        onChange={setParticipantIds}
      />
      <Button
        primary
        label={t('giftList.saveParticipants')}
        disabled={busy}
        onPress={() => onSaveParticipants(participantIds)}
      />

      <Text style={styles.wishlistTitle}>{t('giftList.settings')}</Text>
      <Text style={styles.label}>{t('giftList.titleLabel')}</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={120} />
      <Text style={styles.label}>{t('giftList.occasionDate')}</Text>
      <TextInput
        style={styles.input}
        value={occasionDate}
        onChangeText={setOccasionDate}
        placeholder="YYYY-MM-DD"
        maxLength={10}
      />
      <Text style={styles.label}>{t('giftList.budget')}</Text>
      <TextInput
        style={styles.input}
        value={budget}
        onChangeText={setBudget}
        placeholder={t('giftList.budgetPlaceholder')}
        maxLength={40}
      />
      <View style={styles.switchRow}>
        <Text style={styles.label}>{t('giftList.drawEnabled')}</Text>
        <Switch value={drawEnabled} onValueChange={setDrawEnabled} />
      </View>

      {drawEnabled && (
        <>
          <Text style={styles.label}>{t('giftList.exclusions')}</Text>
          <Text style={styles.muted}>{t('giftList.exclusionsHintMobile')}</Text>
          {exclusions.map(([a, b]) => (
            <View key={`${a}|${b}`} style={styles.switchRow}>
              <Text style={styles.body}>
                {nameOf(a)} ↔ {nameOf(b)}
              </Text>
              <IconButton
                name="x"
                label={t('giftList.removeExclusion')}
                onPress={() => setExclusions(exclusions.filter(([x, y]) => !(x === a && y === b)))}
              />
            </View>
          ))}
          <View style={styles.row}>
            {giftList.participants.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.chip, pairStart === p.id && styles.chipActive]}
                onPress={() => tapPerson(p.id)}
              >
                <Text style={styles.chipText}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <Button
        primary
        label={t('giftList.saveSettings')}
        disabled={busy || !title.trim() || !dateValid}
        onPress={() =>
          onSaveSettings({
            title: title.trim(),
            occasionDate: occasionDate || null,
            budget: budget.trim() || null,
            drawEnabled,
            exclusions,
          })
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 14, paddingBottom: 48 },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  recipientSection: { borderWidth: 2, borderColor: colors.primary },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 11,
    paddingVertical: 3,
  },
  badgeText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 11, color: colors.white },
  title: { fontFamily: 'Nunito_900Black', fontSize: 24, color: colors.textTitle },
  body: { fontFamily: 'Nunito_600SemiBold', fontSize: 15, color: colors.textBody },
  muted: { fontFamily: 'Nunito_600SemiBold', fontSize: 13, color: colors.textMuted },
  label: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.textBody },
  error: { fontFamily: 'Nunito_600SemiBold', fontSize: 13, color: colors.danger },
  link: { fontFamily: 'Nunito_700Bold', fontSize: 13, color: colors.primary },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
  },
  recipientText: { flex: 1, fontFamily: 'Nunito_800ExtraBold', fontSize: 15, color: colors.primaryDark },
  recipientTag: { fontFamily: 'Nunito_800ExtraBold', fontSize: 12, color: colors.primary },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  buttonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  buttonText: { fontFamily: 'Nunito_800ExtraBold', fontSize: 14, color: colors.primaryDark },
  buttonTextPrimary: { color: colors.white },
  disabled: { opacity: 0.4 },
  wishlistHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wishlistTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 17, color: colors.textTitle },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemPhoto: { width: 52, height: 52, borderRadius: 10 },
  itemTitle: { fontFamily: 'Nunito_800ExtraBold', fontSize: 15, color: colors.textTitle },
  itemActions: { flexDirection: 'row' },
  iconButton: { padding: 6 },
  form: { gap: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: colors.textBody,
    backgroundColor: colors.surface,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  chipText: { fontFamily: 'Nunito_700Bold', fontSize: 13, color: colors.textBody },
})
