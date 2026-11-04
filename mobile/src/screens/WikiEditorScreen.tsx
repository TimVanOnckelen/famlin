import React, { useState } from 'react'
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Switch, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import {
  createWikiPage,
  fetchGroups,
  fetchMyCircles,
  fetchWikiCategories,
  fetchWikiPage,
  updateWikiPage,
  wikiConflictPage,
  wikiPostLinkMarkdown,
  type WikiPage,
} from '@famlin/api-client'

import { colors } from '@/constants/colors'
import { Icon, type IconName } from '@/components/Icon'
import { KeyboardAwareScrollView } from '@/components/KeyboardAware'
import { ScreenHeader } from '@/components/ScreenHeader'
import { WikiContent } from '@/components/WikiContent'
import { WikiLinkPostModal } from '@/components/WikiLinkPostModal'
import { usePickAndUploadMedia } from '@/hooks/usePickAndUploadMedia'
import {
  insertBlockAtCursor,
  prefixLines,
  surroundSelection,
  type EditResult,
  type TextSelection,
} from '@/utils/wikiEditor'
import type { Group, Post } from '@/types'

// Creating (no pageId) or editing a Family Wiki page (issue #118). The
// content is Markdown in a plain multiline input with a small formatting
// toolbar and a preview; the photo button uploads an image and inserts it at
// the cursor. Saving an edit sends the version it started from, so a
// concurrent save by someone else is caught (409) instead of silently
// overwritten. Mirrors web's WikiEditorPage.
export function WikiEditorScreen() {
  const { t } = useTranslation()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const queryClient = useQueryClient()
  const {
    pageId,
    groupId,
    category: initialCategory,
  } = (route.params ?? {}) as { pageId?: string; groupId?: string; category?: string }
  const isNew = !pageId

  const pageQuery = useQuery({
    queryKey: ['wiki', 'page', pageId],
    queryFn: () => fetchWikiPage(pageId!),
    enabled: !isNew,
    // The form is seeded from a version fetched for this editor, never from
    // the page screen's cached copy (see `loaded` below), so always refetch.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: fetchGroups, enabled: isNew })
  const familyId = isNew ? (groupId ?? groupsQuery.data?.[0]?.id) : pageQuery.data?.groupId
  const family = groupsQuery.data?.find((g: Group) => g.id === familyId)

  const categoriesQuery = useQuery({
    queryKey: ['wiki', 'categories', familyId],
    queryFn: () => fetchWikiCategories(familyId!),
    enabled: !!familyId,
  })
  const circlesQuery = useQuery({
    queryKey: ['circles', familyId],
    queryFn: () => fetchMyCircles(familyId!),
    enabled: isNew && !!familyId,
  })

  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('')
  const [category, setCategory] = useState(initialCategory ?? '')
  const [content, setContent] = useState('')
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 })
  const [locked, setLocked] = useState(false)
  const [circleId, setCircleId] = useState('')
  const [base, setBase] = useState<WikiPage | null>(null)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<WikiPage | null>(null)
  const [linkingPost, setLinkingPost] = useState(false)
  // Focus moves into the picker, so remember where to insert.
  // The selection when the picker opened — focus moves into the picker.
  const [linkRange, setLinkRange] = useState<TextSelection | null>(null)

  function applyPage(source: WikiPage) {
    setBase(source)
    setTitle(source.title)
    setEmoji(source.emoji ?? '')
    setCategory(source.category ?? '')
    setContent(source.content)
    setSelection({ start: source.content.length, end: source.content.length })
    setLocked(source.locked)
  }

  // Seed the form once, from a version fetched for this editor — never the
  // page screen's cached copy, which may be outdated and would only lead to
  // a spurious conflict on save.
  const loaded = pageQuery.isFetchedAfterMount ? pageQuery.data : undefined
  // Adjusting state during render rather than in an effect, React's pattern
  // for state derived from data that arrives later (same as web's editor).
  if (loaded && !base) applyPage(loaded)

  const canManage = isNew || !!base?.canManage
  const notEditable = !isNew && !!loaded && !loaded.canEdit

  const { pick: pickPhotos, uploading } = usePickAndUploadMedia({
    pickerOptions: {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
    },
    onError: () => setError(t('wiki.uploadFailed')),
  })

  function apply(result: EditResult) {
    setContent(result.text)
    setSelection(result.selection)
  }

  // Replaces the remembered selection with a link to the picked post;
  // selected text, if any, becomes the link's label instead of the post's own.
  function insertPostLink(post: Post, label: string) {
    setLinkingPost(false)
    const range = linkRange ?? { start: content.length, end: content.length }
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const link = wikiPostLinkMarkdown(post, content.slice(start, end).trim() || label)
    const caret = start + link.length
    apply({ text: content.slice(0, start) + link + content.slice(end), selection: { start: caret, end: caret } })
  }

  async function addPhotos() {
    setError(null)
    const result = await pickPhotos()
    if (result?.urls.length) {
      apply(insertBlockAtCursor(content, selection, result.urls.map((url) => `![](${url})`).join('\n')))
    }
  }

  async function save(overrideBase?: WikiPage) {
    if (!title.trim() || !familyId || saving) return
    setSaving(true)
    setError(null)
    try {
      const fields = {
        title: title.trim(),
        emoji: emoji.trim() || null,
        category: category.trim() || null,
        content,
        locked,
      }
      const saved = isNew
        ? await createWikiPage({ groupId: familyId, circleId: circleId || null, ...fields })
        : await updateWikiPage(pageId!, {
            ...fields,
            ...(canManage ? {} : { locked: undefined }),
            baseUpdatedAt: (overrideBase ?? base)?.updatedAt,
          })
      queryClient.setQueryData(['wiki', 'page', saved.id], saved)
      void queryClient.invalidateQueries({ queryKey: ['wiki', 'pages'] })
      void queryClient.invalidateQueries({ queryKey: ['wiki', 'categories'] })
      if (isNew) navigation.replace('WikiPage', { pageId: saved.id })
      else navigation.goBack()
    } catch (err) {
      const current = wikiConflictPage(err)
      if (current) setConflict(current)
      else setError(t('wiki.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  function takeTheirs() {
    if (!conflict) return
    applyPage(conflict)
    setConflict(null)
  }

  function keepMine() {
    if (!conflict) return
    const latest = conflict
    setBase(latest)
    setConflict(null)
    void save(latest)
  }

  const suggestions = (categoriesQuery.data ?? []).filter(
    (c) => c.name && c.name.toLowerCase() !== category.trim().toLowerCase()
  )
  const circles = circlesQuery.data ?? []
  const showForm = isNew || (!!base && !notEditable)

  const tools: { icon?: IconName; label: string; text?: string; onPress: () => void; disabled?: boolean }[] = [
    { text: 'H', label: t('wiki.fmtHeading'), onPress: () => apply(prefixLines(content, selection, '## ')) },
    {
      text: 'B',
      label: t('wiki.fmtBold'),
      onPress: () => apply(surroundSelection(content, selection, '**', '**', t('wiki.fmtBold'))),
    },
    {
      text: 'I',
      label: t('wiki.fmtItalic'),
      onPress: () => apply(surroundSelection(content, selection, '*', '*', t('wiki.fmtItalic'))),
    },
    { text: '•', label: t('wiki.fmtList'), onPress: () => apply(prefixLines(content, selection, '- ')) },
    {
      icon: 'check-square',
      label: t('wiki.fmtChecklist'),
      onPress: () => apply(prefixLines(content, selection, '- [ ] ')),
    },
    {
      icon: 'external-link',
      label: t('wiki.fmtLink'),
      onPress: () => apply(surroundSelection(content, selection, '[', '](https://)', t('wiki.fmtLinkText'))),
    },
    {
      icon: 'link',
      label: t('wiki.fmtLinkPost'),
      onPress: () => {
        setLinkRange(selection)
        setLinkingPost(true)
      },
      disabled: !familyId,
    },
    { icon: 'image', label: t('wiki.fmtPhoto'), onPress: addPhotos, disabled: uploading },
  ]

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={isNew ? t('wiki.newPage') : t('wiki.editPage')}
        onBack={() => navigation.goBack()}
        centered
        right={
          showForm ? (
            <TouchableOpacity
              style={[styles.saveButton, (saving || uploading || !title.trim()) && styles.saveButtonDisabled]}
              onPress={() => void save()}
              disabled={saving || uploading || !title.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.saveButtonText}>{saving ? t('wiki.saving') : t('wiki.save')}</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <KeyboardAwareScrollView contentContainerStyle={styles.scroll}>
        {!isNew && !loaded && !pageQuery.isError && <ActivityIndicator color={colors.primary} style={styles.loading} />}
        {!isNew && pageQuery.isError && <Text style={styles.hint}>{t('wiki.notAvailable')}</Text>}
        {notEditable && <Text style={styles.hint}>{t('wiki.lockedHint')}</Text>}

        {showForm && (
          <View style={styles.form}>
            {isNew && !!family && <Text style={styles.intro}>{t('wiki.inFamily', { family: family.name })}</Text>}

            <View style={styles.row}>
              <View style={styles.emojiField}>
                <Text style={styles.label}>{t('wiki.emojiLabel')}</Text>
                <TextInput
                  style={[styles.input, styles.emojiInput]}
                  value={emoji}
                  onChangeText={setEmoji}
                  maxLength={16}
                  placeholder="📄"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={t('wiki.emojiLabel')}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.label}>{t('wiki.titleLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={120}
                  placeholder={t('wiki.titlePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={t('wiki.titleLabel')}
                />
              </View>
            </View>

            <Text style={styles.label}>{t('wiki.categoryLabel')}</Text>
            <TextInput
              style={styles.input}
              value={category}
              onChangeText={setCategory}
              maxLength={60}
              placeholder={t('wiki.categoryPlaceholder')}
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={t('wiki.categoryLabel')}
            />
            {suggestions.length > 0 && (
              <View style={styles.chipWrap}>
                {suggestions.map((c) => (
                  <TouchableOpacity key={c.name} style={styles.chip} onPress={() => setCategory(c.name!)}>
                    <Text style={styles.chipText}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {isNew && circles.length > 0 && (
              <>
                <Text style={styles.label}>{t('wiki.audienceLabel')}</Text>
                <View style={styles.chipWrap}>
                  <TouchableOpacity
                    style={[styles.chip, !circleId && styles.chipActive]}
                    onPress={() => setCircleId('')}
                    accessibilityState={{ selected: !circleId }}
                  >
                    <Text style={[styles.chipText, !circleId && styles.chipTextActive]}>
                      {t('wiki.audienceFamily')}
                    </Text>
                  </TouchableOpacity>
                  {circles.map((circle) => {
                    const active = circleId === circle.id
                    return (
                      <TouchableOpacity
                        key={circle.id}
                        style={[styles.chip, styles.circleChip, active && styles.circleChipActive]}
                        onPress={() => setCircleId(circle.id)}
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.chipText, styles.circleChipText, active && styles.chipTextActive]}>
                          {circle.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </>
            )}
            {!isNew && !!base?.circle && (
              <View style={styles.circleNote}>
                <Icon name="users" size={14} color={colors.circleDark} />
                <Text style={styles.circleNoteText}>{t('wiki.circleOnly', { circle: base.circle.name })}</Text>
              </View>
            )}

            <View style={styles.tabs}>
              {[false, true].map((isPreview) => (
                <TouchableOpacity
                  key={String(isPreview)}
                  style={[styles.chip, preview === isPreview && styles.chipActive]}
                  onPress={() => setPreview(isPreview)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: preview === isPreview }}
                >
                  <Text style={[styles.chipText, preview === isPreview && styles.chipTextActive]}>
                    {isPreview ? t('wiki.preview') : t('wiki.write')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {preview ? (
              <View style={styles.preview}>
                {content.trim() ? (
                  <WikiContent content={content} />
                ) : (
                  <Text style={styles.hint}>{t('wiki.emptyPage')}</Text>
                )}
              </View>
            ) : (
              <View>
                <View style={styles.toolbar} accessibilityRole="toolbar" accessibilityLabel={t('wiki.formatting')}>
                  {tools.map((tool) => (
                    <TouchableOpacity
                      key={tool.label}
                      style={[styles.tool, tool.disabled && styles.toolDisabled]}
                      onPress={tool.onPress}
                      disabled={tool.disabled}
                      accessibilityRole="button"
                      accessibilityLabel={tool.label}
                    >
                      {tool.icon ? (
                        <Icon name={tool.icon} size={18} color={colors.textTitle} />
                      ) : (
                        <Text
                          style={[
                            styles.toolText,
                            tool.text === 'B' && styles.toolBold,
                            tool.text === 'I' && styles.toolItalic,
                          ]}
                        >
                          {tool.text}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                  {uploading && <Text style={styles.uploading}>{t('wiki.uploading')}</Text>}
                </View>
                <TextInput
                  style={[styles.input, styles.contentInput]}
                  value={content}
                  onChangeText={setContent}
                  selection={selection}
                  onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
                  multiline
                  textAlignVertical="top"
                  maxLength={50_000}
                  placeholder={t('wiki.contentPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={t('wiki.contentLabel')}
                />
                <Text style={styles.help}>{t('wiki.formatHelp')}</Text>
              </View>
            )}

            {canManage && (
              <View style={styles.lockRow}>
                <Switch
                  value={locked}
                  onValueChange={setLocked}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  accessibilityLabel={t('wiki.lockLabel')}
                />
                <Text style={styles.lockText}>
                  <Text style={styles.lockStrong}>{t('wiki.lockLabel')}</Text> {t('wiki.lockHelp')}
                </Text>
              </View>
            )}

            {!!conflict && (
              <View style={styles.conflict}>
                <Text style={styles.conflictText}>
                  {t('wiki.conflict', { name: conflict.updatedBy?.name ?? t('wiki.someoneElse') })}
                </Text>
                <TouchableOpacity style={styles.conflictButton} onPress={takeTheirs} accessibilityRole="button">
                  <Text style={styles.conflictButtonText}>{t('wiki.conflictTakeTheirs')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.conflictButton} onPress={keepMine} accessibilityRole="button">
                  <Text style={styles.conflictButtonText}>{t('wiki.conflictKeepMine')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>
        )}
      </KeyboardAwareScrollView>
      {!!familyId && linkingPost && (
        <WikiLinkPostModal visible groupId={familyId} onPick={insertPostLink} onCancel={() => setLinkingPost(false)} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: 12, paddingBottom: 60 },
  loading: { marginTop: 40 },
  hint: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textMuted, textAlign: 'center', padding: 16 },
  form: { gap: 8 },
  intro: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textMuted },
  row: { flexDirection: 'row', gap: 10 },
  emojiField: { width: 76 },
  label: { fontFamily: 'Nunito_700Bold', fontSize: 13, color: colors.textMuted, marginBottom: 4, marginTop: 4 },
  input: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: colors.textTitle,
  },
  emojiInput: { textAlign: 'center' },
  contentInput: { minHeight: 260, lineHeight: 22 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textTitle },
  chipTextActive: { color: colors.white },
  circleChip: { backgroundColor: colors.circleTint, borderColor: colors.circleTint },
  circleChipActive: { backgroundColor: colors.circle, borderColor: colors.circle },
  circleChipText: { color: colors.circleDark },
  circleNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  circleNoteText: { fontFamily: 'Nunito_600SemiBold', fontSize: 13, color: colors.circleDark },
  preview: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    minHeight: 120,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tool: {
    width: 40,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolDisabled: { opacity: 0.5 },
  toolText: { fontFamily: 'Nunito_700Bold', fontSize: 16, color: colors.textTitle },
  toolBold: { fontFamily: 'Nunito_900Black' },
  toolItalic: { fontStyle: 'italic' },
  uploading: { fontFamily: 'Nunito_600SemiBold', fontSize: 12, color: colors.textMuted },
  help: { fontFamily: 'Nunito_600SemiBold', fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 6 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  lockText: { flex: 1, fontFamily: 'Nunito_600SemiBold', fontSize: 14, color: colors.textBody },
  lockStrong: { fontFamily: 'Nunito_800ExtraBold' },
  conflict: {
    gap: 8,
    backgroundColor: colors.circleTint,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  conflictText: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.circleDark },
  conflictButton: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.circleDark,
    backgroundColor: colors.white,
    paddingVertical: 9,
    alignItems: 'center',
  },
  conflictButtonText: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.circleDark },
  error: { fontFamily: 'Nunito_700Bold', fontSize: 14, color: colors.danger, marginTop: 8 },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 7,
    minWidth: 70,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { fontFamily: 'Nunito_700Bold', fontSize: 15, color: colors.white },
})
