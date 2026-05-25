import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as ImagePicker from 'expo-image-picker';
import { Message, UserProfile } from '../types';
import { useChat } from '../hooks/useChat';
import { calculateStreak } from '../utils/streak';
import { colors, spacing, radius, fontSize } from '../constants/theme';

interface Props {
  profile: UserProfile | null;
  apiKey: string | null;
}

// Renderiza linhas com **negrito** e *itálico* sem dependência externa
function AIText({ content }: { content: string }) {
  return (
    <View>
      {content.split('\n').map((line, lineIdx) => {
        const isBullet = /^[-•*]\s/.test(line);
        const isHeading = /^#{1,3}\s/.test(line);
        const cleanLine = line.replace(/^[-•*]\s/, '').replace(/^#{1,3}\s/, '');

        const parts: React.ReactNode[] = [];
        const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = regex.exec(cleanLine)) !== null) {
          if (m.index > last) parts.push(cleanLine.slice(last, m.index));
          if (m[1]) parts.push(<Text key={m.index} style={{ fontWeight: '700', color: colors.text }}>{m[1]}</Text>);
          else if (m[2]) parts.push(<Text key={m.index} style={{ fontStyle: 'italic' }}>{m[2]}</Text>);
          last = m.index + m[0].length;
        }
        if (last < cleanLine.length) parts.push(cleanLine.slice(last));

        return (
          <Text
            key={lineIdx}
            style={[
              styles.aiText,
              isHeading && styles.aiHeading,
              isBullet && styles.aiBullet,
              lineIdx > 0 && !isBullet && { marginTop: 4 },
            ]}
          >
            {isBullet && <Text style={styles.bulletDot}>• </Text>}
            {parts}
          </Text>
        );
      })}
    </View>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const time = format(message.timestamp, 'HH:mm', { locale: ptBR });

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAI]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>AF</Text>
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}>
        {message.imageUri && (
          <Image source={{ uri: message.imageUri }} style={styles.bubbleImage} resizeMode="cover" />
        )}
        {isUser ? (
          message.content !== '📷 Imagem enviada' || !message.imageUri
            ? <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{message.content}</Text>
            : null
        ) : (
          <AIText content={message.content} />
        )}
        <Text style={[styles.timestamp, isUser && styles.timestampUser]}>{time}</Text>
        {message.extractedData && message.extractedData.length > 0 && (
          <View style={styles.dataTag}>
            <Text style={styles.dataTagText}>+{message.extractedData.length} dado(s) salvo(s)</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function ChatScreen({ profile, apiKey }: Props) {
  const { messages, isLoading, sendMessage, clearHistory } = useChat(profile, apiKey);
  const [inputText, setInputText] = useState('');
  const [pendingImage, setPendingImage] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);
  const listRef = useRef<FlatList>(null);
  const streak = calculateStreak(messages);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Precisamos acessar sua galeria para enviar imagens.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0].base64) {
      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'image/jpeg';
      setPendingImage({ uri: asset.uri, base64: asset.base64!, mimeType: mime });
    }
  };

  const handleSend = () => {
    if (!inputText.trim() && !pendingImage) return;
    sendMessage(inputText, pendingImage?.base64, pendingImage?.mimeType, pendingImage?.uri);
    setInputText('');
    setPendingImage(null);
  };

  const quickPrompts = [
    'Como foi meu treino de hoje',
    'O que comer antes de treinar?',
    'Dica de recuperação',
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <View>
            <Text style={styles.headerTitle}>AmigoFit</Text>
            <Text style={styles.headerSubtitle}>Seu parceiro de treino</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {streak > 0 && (
            <View style={styles.streakBadge}>
              <Text style={styles.streakIcon}>🔥</Text>
              <Text style={styles.streakText}>{streak}</Text>
            </View>
          )}
          <TouchableOpacity onPress={clearHistory} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Limpar</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        style={styles.list}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListFooterComponent={
          isLoading ? (
            <View style={styles.typingIndicator}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>AF</Text>
              </View>
              <View style={styles.bubbleAI}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            </View>
          ) : null
        }
      />

      {messages.length <= 1 && (
        <View style={styles.quickPrompts}>
          {quickPrompts.map((prompt) => (
            <TouchableOpacity
              key={prompt}
              style={styles.quickPromptBtn}
              onPress={() => sendMessage(prompt)}
            >
              <Text style={styles.quickPromptText}>{prompt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
      >
        {pendingImage && (
          <View style={styles.imagePreviewRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.imagePreview} resizeMode="cover" />
            <TouchableOpacity style={styles.imagePreviewRemove} onPress={() => setPendingImage(null)}>
              <Text style={styles.imagePreviewRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.imageBtn} onPress={handlePickImage} disabled={isLoading}>
            <Text style={styles.imageBtnIcon}>🖼</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Conta como tá o treino..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() && !pendingImage || isLoading) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={(!inputText.trim() && !pendingImage) || isLoading}
          >
            <Text style={styles.sendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  headerSubtitle: { color: colors.textSecondary, fontSize: fontSize.xs },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,100,0,0.15)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,100,0,0.3)',
  },
  streakIcon: { fontSize: 13 },
  streakText: { color: '#FF6400', fontSize: fontSize.sm, fontWeight: '700' },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  clearBtnText: { color: colors.textMuted, fontSize: fontSize.xs },
  messageList: { padding: spacing.md, paddingBottom: spacing.xl },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing.md, alignItems: 'flex-end', gap: spacing.sm },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAI: { justifyContent: 'flex-start' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#000', fontSize: fontSize.xs, fontWeight: '800' },
  bubble: { maxWidth: '78%', borderRadius: radius.lg, padding: spacing.md },
  bubbleUser: { backgroundColor: colors.userBubble, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: colors.aiBubble, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  bubbleTextUser: { color: '#000' },
  aiText:    { color: colors.text, fontSize: fontSize.md, lineHeight: 22 },
  aiHeading: { fontWeight: '700', fontSize: fontSize.lg, color: colors.primary, marginBottom: 2 },
  aiBullet:  { marginLeft: 4 },
  bulletDot: { color: colors.primary },
  timestamp: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4 },
  timestampUser: { color: 'rgba(0,0,0,0.4)', textAlign: 'right' },
  dataTag: {
    marginTop: spacing.xs,
    backgroundColor: 'rgba(0,200,83,0.15)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  dataTagText: { color: colors.primary, fontSize: fontSize.xs },
  typingIndicator: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  quickPrompts: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs, flexDirection: 'row', flexWrap: 'wrap' },
  quickPromptBtn: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickPromptText: { color: colors.textSecondary, fontSize: fontSize.sm },
  imagePreviewRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  imagePreview: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imagePreviewRemove: {
    position: 'absolute',
    top: spacing.sm,
    left: 68,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePreviewRemoveText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  bubbleImage: {
    width: 200,
    height: 200,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  imageBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  imageBtnIcon: { fontSize: 22 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.surface },
  sendIcon: { color: '#000', fontSize: fontSize.lg, fontWeight: '700' },
});
