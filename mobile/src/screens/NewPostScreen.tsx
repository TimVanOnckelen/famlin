import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
  Alert,
  SafeAreaView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { colors } from '@/constants/colors';
import { Icon } from '@/components/Icon';
import { api } from '@/api/client';
import { Group, Post } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { AlbumPicker } from '@/components/AlbumPicker';
import { getImmichAssetUrl } from '@/api/immich';
import { uploadImages, getUploadUrl } from '@/api/uploads';

const MILESTONE_TAGS = ['🎂 Verjaardag', '👶 Geboorte', '💍 Jubileum', '🎓 Diploma'];

export function NewPostScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [content, setContent] = useState('');
  const [isMilestone, setIsMilestone] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [selectedImmichAssets, setSelectedImmichAssets] = useState<string[]>([]);
  const [uploadedAssetUrls, setUploadedAssetUrls] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: groups } = useQuery<Group[], Error>({
    queryKey: ['groups'],
    queryFn: async (): Promise<Group[]> => {
      const response = await api.get<Group[]>('/groups');
      return response.data;
    },
  });

  React.useEffect(() => {
    if (groups && groups.length > 0 && !groupId) {
      setGroupId(groups[0].id);
    }
  }, [groups]);

  const createPost = useMutation({
    mutationFn: async () => {
      if (!groupId) throw new Error('Geen groep geselecteerd');
      const response = await api.post<Post>('/posts', {
        groupId,
        content,
        type: isMilestone ? 'MILESTONE' : 'UPDATE',
        milestoneTag: isMilestone ? selectedTag : undefined,
        immichAssetIds: selectedImmichAssets,
        uploadedAssetUrls,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('Fout', err.response?.data?.error || err.message || 'Bericht kon niet worden geplaatst');
    },
  });

  const canSubmit = content.trim().length > 0 || selectedImmichAssets.length > 0 || uploadedAssetUrls.length > 0;

  async function pickImagesFromDevice() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Toegang nodig', 'We hebben toegang nodig tot je foto bibliotheek.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.8,
    });

    console.log('ImagePicker result:', JSON.stringify(result, null, 2));
    if (result.canceled) return;

    const files = result.assets.map((asset, index) => ({
      uri: asset.uri,
      name: asset.fileName || `photo-${index}.jpg`,
      type: asset.mimeType || 'image/jpeg',
    }));
    console.log('Files to upload:', files);

    try {
      setUploading(true);
      const urls = await uploadImages(files);
      console.log('Uploaded URLs:', urls);
      setUploadedAssetUrls((prev) => [...prev, ...urls]);
    } catch (err: any) {
      console.error('Upload error:', err);
      Alert.alert('Upload mislukt', err.response?.data?.error || err.message || 'Probeer het opnieuw');
    } finally {
      setUploading(false);
    }
  }

  function removeImmichAsset(assetId: string) {
    setSelectedImmichAssets((prev) => prev.filter((id) => id !== assetId));
  }

  function removeUploadedAsset(url: string) {
    setUploadedAssetUrls((prev) => prev.filter((u) => u !== url));
  }

  const allAssets = [
    ...selectedImmichAssets.map((id) => ({ type: 'immich' as const, id })),
    ...uploadedAssetUrls.map((url) => ({ type: 'upload' as const, url })),
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancelButton}>Annuleren</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nieuw bericht</Text>
        <TouchableOpacity
          style={[styles.postButton, !canSubmit && styles.postButtonDisabled]}
          onPress={() => createPost.mutate()}
          disabled={!canSubmit}
        >
          <Text style={styles.postButtonText}>Plaatsen</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.form} contentContainerStyle={styles.formContent}>
        <View style={styles.authorRow}>
          <View style={[styles.avatar, { backgroundColor: colors.coral }]}>
            <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || '?'}</Text>
          </View>
          <View>
            <Text style={styles.authorName}>{user?.name}</Text>
            <Text style={styles.groupName}>
              {groups?.find((g: Group) => g.id === groupId)?.name || 'Laden...'}
            </Text>
          </View>
        </View>

        {groups && groups.length > 1 && (
          <View style={styles.groupSelector}>
            <Text style={styles.sectionLabel}>Groep</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {groups.map((group: Group) => (
                <TouchableOpacity
                  key={group.id}
                  style={[styles.groupChip, group.id === groupId && styles.groupChipActive]}
                  onPress={() => setGroupId(group.id)}
                >
                  <Text
                    style={[
                      styles.groupChipText,
                      group.id === groupId && styles.groupChipTextActive,
                    ]}
                  >
                    {group.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <TextInput
          style={styles.textInput}
          placeholder="Schrijf iets voor de familie..."
          placeholderTextColor={colors.warmGray}
          multiline
          value={content}
          onChangeText={setContent}
          autoFocus
        />

        {allAssets.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectedAssets}>
            {allAssets.map((asset) => (
              <View key={asset.type === 'immich' ? asset.id : asset.url} style={styles.selectedAsset}>
                <Image
                  source={{
                    uri: asset.type === 'immich'
                      ? getImmichAssetUrl(asset.id, 'thumbnail')
                      : getUploadUrl(asset.url),
                  }}
                  style={styles.selectedAssetImage}
                />
                <TouchableOpacity
                  style={styles.removeAssetButton}
                  onPress={() =>
                    asset.type === 'immich'
                      ? removeImmichAsset(asset.id)
                      : removeUploadedAsset(asset.url)
                  }
                >
                  <Icon name="x" size={12} color={colors.white} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {uploading && (
          <View style={styles.uploadingRow}>
            <ActivityIndicator size="small" color={colors.coral} />
            <Text style={styles.uploadingText}>Foto's uploaden...</Text>
          </View>
        )}

        <View style={styles.photoButtonsRow}>
          <TouchableOpacity style={styles.addPhotoButton} onPress={() => setPickerVisible(true)}>
            <View style={styles.addPhotoIcon}>
              <Icon name="image" size={18} color={colors.white} />
            </View>
            <View>
              <Text style={styles.addPhotoTitle}>Immich</Text>
              <Text style={styles.addPhotoSubtitle}>Kies uit album</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.addPhotoButton} onPress={pickImagesFromDevice} disabled={uploading}>
            <View style={styles.addPhotoIcon}>
              <Icon name="smartphone" size={18} color={colors.white} />
            </View>
            <View>
              <Text style={styles.addPhotoTitle}>Toestel</Text>
              <Text style={styles.addPhotoSubtitle}>Kies uit galerij</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <View style={styles.milestoneRow}>
          <View>
            <Text style={styles.milestoneTitle}>🎂 Dit is een mijlpaal</Text>
            <Text style={styles.milestoneSubtitle}>Bijv. verjaardag, geboorte, jubileum</Text>
          </View>
          <Switch
            value={isMilestone}
            onValueChange={setIsMilestone}
            trackColor={{ false: colors.lightGray, true: colors.amber }}
            thumbColor={colors.white}
          />
        </View>

        {isMilestone && (
          <View style={styles.tagList}>
            {MILESTONE_TAGS.map((tag) => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, selectedTag === tag && styles.tagChipActive]}
                onPress={() => setSelectedTag(tag)}
              >
                <Text
                  style={[styles.tagChipText, selectedTag === tag && styles.tagChipTextActive]}
                >
                  {tag}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <AlbumPicker
        visible={pickerVisible}
        selectedAssetIds={selectedImmichAssets}
        onSelect={setSelectedImmichAssets}
        onClose={() => setPickerVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancelButton: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 17,
    color: colors.coral,
    minHeight: 44,
    textAlignVertical: 'center',
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmBlack,
  },
  postButton: {
    backgroundColor: colors.coral,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 100,
  },
  postButtonDisabled: {
    backgroundColor: colors.lightGray,
  },
  postButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.white,
  },
  form: {
    flex: 1,
  },
  formContent: {
    padding: 16,
    paddingBottom: 44,
    gap: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    color: colors.white,
  },
  authorName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: colors.warmBlack,
  },
  groupName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    marginTop: 2,
  },
  groupSelector: {
    gap: 8,
  },
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: colors.warmBlack,
  },
  groupChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.lightGray,
    marginRight: 8,
  },
  groupChipActive: {
    backgroundColor: colors.coral,
    borderColor: colors.coral,
  },
  groupChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmBlack,
  },
  groupChipTextActive: {
    color: colors.white,
  },
  textInput: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 18,
    color: colors.warmBlack,
    lineHeight: 28,
    minHeight: 100,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.lightGray,
    paddingBottom: 16,
  },
  selectedAssets: {
    gap: 10,
    paddingVertical: 4,
  },
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  uploadingText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmGray,
  },
  selectedAsset: {
    width: 110,
    height: 110,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  selectedAssetImage: {
    width: 110,
    height: 110,
  },
  removeAssetButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  addPhotoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.lightGray,
    borderStyle: 'dashed',
    backgroundColor: colors.cream,
    borderRadius: 14,
    padding: 12,
  },
  addPhotoIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: colors.warmBlack,
  },
  addPhotoSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.lightGray,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  milestoneTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: colors.warmBlack,
  },
  milestoneSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: colors.warmGray,
    marginTop: 2,
  },
  tagList: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tagChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1.5,
    borderColor: colors.lightGray,
    backgroundColor: colors.cream,
  },
  tagChipActive: {
    borderColor: colors.amber,
    backgroundColor: '#FFF5E6',
  },
  tagChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: colors.warmGray,
  },
  tagChipTextActive: {
    color: colors.warmBlack,
    fontFamily: 'Nunito_700Bold',
  },
});
