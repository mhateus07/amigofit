import React, { useRef, useEffect, useState, useMemo } from 'react';
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
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import * as ImagePicker from 'expo-image-picker';
import { Message, UserProfile } from '../types';
import { useChat } from '../hooks/useChat';
import { chatImageUrl, getToken } from '../services/storage';
import { errorMessage } from '../services/api';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { calculateStreak } from '../utils/streak';
import { colors, spacing, radius, fontSize, fontFamily, shadow } from '../constants/theme';

interface Props {
  profile: UserProfile | null;
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
          if (m[1]) parts.push(<Text key={m.index} style={{ fontFamily: fontFamily.semiBold, color: colors.text }}>{m[1]}</Text>);
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

function MessageBubble({ message, token, onRetry, onDiscardExtraction }: {
  message: Message;
  token: string | null;
  onRetry: (id: string) => void;
  onDiscardExtraction: (id: string) => Promise<void>;
}) {
  const isUser = message.role === 'user';
  const time = format(message.timestamp, 'HH:mm', { locale: ptBR });

  // A IA mostra o que entendeu da mensagem e deixa descartar antes de o
  // registro virar histórico definitivo.
  const reviewExtraction = () => {
    const items = message.extractedData ?? [];
    const list = items.map((d) => `• ${d.label}: ${d.value}`).join('\n');
    Alert.alert('Identifiquei estes registros', `${list}\n\nEles já estão no Diário. Pode corrigir cada um por lá.`, [
      { text: 'Manter', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          try {
            await onDiscardExtraction(message.id);
          } catch (e) {
            Alert.alert('Não foi possível descartar', errorMessage(e));
          }
        },
      },
    ]);
  };

  const handleLongPress = () => {
    const text = message.content;
    Alert.alert('Mensagem', undefined, [
      {
        text: 'Copiar',
        onPress: async () => {
          await Clipboard.setStringAsync(text);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  };

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAI]}>
      {!isUser && (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>AF</Text>
        </View>
      )}
      <TouchableOpacity
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAI]}
        onLongPress={handleLongPress}
        activeOpacity={1}
        delayLongPress={400}
      >
        {message.imageUri ? (
          <Image source={{ uri: message.imageUri }} style={styles.bubbleImage} resizeMode="cover" accessibilityLabel="Imagem enviada" />
        ) : message.imageId && token ? (
          <Image
            source={{ uri: chatImageUrl(message.imageId), headers: { Authorization: `Bearer ${token}` } }}
            style={styles.bubbleImage}
            resizeMode="cover"
            accessibilityLabel="Imagem enviada"
          />
        ) : null}
        {isUser ? (
          message.content !== '📷 Imagem enviada' || !(message.imageUri || message.imageId)
            ? <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{message.content}</Text>
            : null
        ) : (
          <AIText content={message.content} />
        )}
        <Text style={[styles.timestamp, isUser && styles.timestampUser]}>{time}</Text>
        {message.extractedData && message.extractedData.length > 0 && (
          <TouchableOpacity
            style={styles.dataTag}
            onPress={reviewExtraction}
            accessibilityRole="button"
            accessibilityLabel={`Identifiquei ${message.extractedData.length} registro(s). Tocar para revisar`}
          >
            <Text style={styles.dataTagText}>
              Identifiquei {message.extractedData.length} registro{message.extractedData.length !== 1 ? 's' : ''} · revisar
            </Text>
          </TouchableOpacity>
        )}
        {message.saveFailed && (
          <TouchableOpacity
            style={styles.saveFailed}
            onPress={() => onRetry(message.id)}
            accessibilityRole="button"
            accessibilityLabel="Mensagem não salva. Tocar para tentar de novo"
          >
            <Text style={styles.saveFailedText}>⚠️ Não salva — tocar para tentar de novo</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </View>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function ChatScreen({ profile }: Props) {
  const {
    messages, isLoading, sendMessage, clearHistory,
    loadState, loadError, reload, hasMore, loadingMore, loadMore, retrySave, discardExtraction, offline,
  } = useChat(profile);
  const [inputText, setInputText] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);
  const listRef = useRef<FlatList>(null);
  const streak = calculateStreak(messages);
  const {
    isRecording,
    isTranscribing,
    durationMillis,
    startRecording,
    stopRecordingAndTranscribe,
    cancelRecording,
  } = useVoiceRecorder();

  useEffect(() => {
    getToken().then(setToken);
  }, []);

  // Lista invertida (padrão de apps de mensagem): o "início" dela é a
  // mensagem mais recente, então o chat sempre abre na última mensagem —
  // ao abrir o app, trocar de aba ou carregar fotos — sem depender de
  // scrollToEnd, que rodava antes do layout terminar e deixava a conversa
  // parada no topo. Mensagem nova também aparece embaixo automaticamente.
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const handleClear = () => {
    Alert.alert('Limpar conversa', 'Apagar todas as mensagens? Os dados já salvos no Diário continuam.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Limpar',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearHistory();
          } catch (e) {
            Alert.alert('Não foi possível limpar', errorMessage(e));
          }
        },
      },
    ]);
  };

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

  const handleStopRecording = async () => {
    const text = await stopRecordingAndTranscribe();
    if (text) {
      setInputText((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    }
  };

  const quickPrompts = [
    'Como foi meu treino de hoje',
    'O que comer antes de treinar?',
    'Dica de recuperação',
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header fica fora do KAV para não subir junto com o teclado */}
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
          <TouchableOpacity
            onPress={handleClear}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Limpar conversa"
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={styles.clearBtnText}>Limpar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* KAV engloba lista + input → input sobe junto com o teclado no Android */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {offline && (
          <TouchableOpacity style={styles.offlineBanner} onPress={reload} accessibilityRole="button">
            <Text style={styles.offlineBannerText}>Sem conexão — mostrando as últimas mensagens salvas. Tocar para atualizar.</Text>
          </TouchableOpacity>
        )}
        {loadState === 'loading' && (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
        {loadState === 'error' && (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>Não foi possível carregar a conversa</Text>
            <Text style={styles.stateText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={reload} accessibilityRole="button">
              <Text style={styles.retryBtnText}>Tentar de novo</Text>
            </TouchableOpacity>
          </View>
        )}
        {loadState === 'ready' && (
        <FlatList
          ref={listRef}
          inverted
          data={invertedMessages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble message={item} token={token} onRetry={retrySave} onDiscardExtraction={discardExtraction} />
          )}
          style={styles.list}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          ListHeaderComponent={
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
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore} accessibilityRole="button">
                {loadingMore
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={styles.loadMoreText}>Carregar mensagens anteriores</Text>}
              </TouchableOpacity>
            ) : null
          }
          // Rolar até o topo busca as mensagens anteriores automaticamente.
          onEndReached={hasMore ? loadMore : undefined}
          onEndReachedThreshold={0.2}
        />
        )}

        {loadState === 'ready' && messages.length <= 1 && (
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

        {pendingImage && (
          <View style={styles.imagePreviewRow}>
            <Image source={{ uri: pendingImage.uri }} style={styles.imagePreview} resizeMode="cover" />
            <TouchableOpacity style={styles.imagePreviewRemove} onPress={() => setPendingImage(null)}>
              <Text style={styles.imagePreviewRemoveText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {isRecording ? (
          <View style={styles.recordingRow}>
            <TouchableOpacity style={styles.recordingCancelBtn} onPress={cancelRecording}>
              <Text style={styles.recordingCancelIcon}>✕</Text>
            </TouchableOpacity>
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>{formatDuration(durationMillis)}</Text>
              <Text style={styles.recordingHint}>Gravando...</Text>
            </View>
            <TouchableOpacity style={styles.recordingStopBtn} onPress={handleStopRecording}>
              <Text style={styles.recordingStopIcon}>✓</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TouchableOpacity style={styles.imageBtn} onPress={handlePickImage} disabled={isLoading || isTranscribing} accessibilityRole="button" accessibilityLabel="Enviar imagem">
              <Text style={styles.imageBtnIcon}>🖼</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.imageBtn} onPress={startRecording} disabled={isLoading || isTranscribing} accessibilityRole="button" accessibilityLabel="Gravar mensagem de voz">
              {isTranscribing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.imageBtnIcon}>🎤</Text>
              )}
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
              accessibilityRole="button"
              accessibilityLabel="Enviar mensagem"
            >
              <Text style={styles.sendIcon}>↑</Text>
            </TouchableOpacity>
          </View>
        )}
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
    backgroundColor: colors.surface,
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
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontFamily: fontFamily.semiBold },
  headerSubtitle: { color: colors.textSecondary, fontSize: fontSize.xs, fontFamily: fontFamily.regular },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FDF0E6',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#F3D9C0',
  },
  streakIcon: { fontSize: 13 },
  streakText: { color: '#B25E00', fontSize: fontSize.sm, fontFamily: fontFamily.semiBold },
  clearBtn: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  clearBtnText: { color: colors.textMuted, fontSize: fontSize.xs, fontFamily: fontFamily.regular },
  // Lista invertida: paddingTop aparece embaixo (perto do campo de texto).
  messageList: { padding: spacing.md, paddingTop: spacing.xl },
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
  avatarText: { color: '#FFFFFF', fontSize: fontSize.xs, fontFamily: fontFamily.bold },
  bubble: { maxWidth: '78%', borderRadius: radius.lg, padding: spacing.md, ...shadow.card },
  bubbleUser: { backgroundColor: colors.userBubble, borderBottomRightRadius: 4 },
  bubbleAI: { backgroundColor: colors.aiBubble, borderBottomLeftRadius: 4, shadowOpacity: 0 },
  bubbleText: { color: colors.text, fontSize: fontSize.md, lineHeight: 22, fontFamily: fontFamily.regular },
  bubbleTextUser: { color: '#FFFFFF' },
  aiText:    { color: colors.text, fontSize: fontSize.md, lineHeight: 22, fontFamily: fontFamily.regular },
  aiHeading: { fontFamily: fontFamily.semiBold, fontSize: fontSize.lg, color: colors.primary, marginBottom: 2 },
  aiBullet:  { marginLeft: 4 },
  bulletDot: { color: colors.primary },
  timestamp: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4, fontFamily: fontFamily.regular },
  timestampUser: { color: 'rgba(255,255,255,0.75)', textAlign: 'right' },
  dataTag: {
    marginTop: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  offlineBanner: { marginHorizontal: spacing.md, marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: '#FFF4E5' },
  offlineBannerText: { color: '#8A5300', fontSize: fontSize.sm },
  saveFailed: { marginTop: 6 },
  saveFailedText: { color: colors.error, fontSize: fontSize.xs, fontFamily: fontFamily.medium },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm },
  stateTitle: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold, textAlign: 'center' },
  stateText: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: fontFamily.regular, textAlign: 'center' },
  retryBtn: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center' },
  retryBtnText: { color: '#fff', fontSize: fontSize.sm, fontFamily: fontFamily.semiBold },
  loadMoreBtn: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
  loadMoreText: { color: colors.primary, fontSize: fontSize.sm, fontFamily: fontFamily.medium },
  dataTagText: { color: colors.primaryDark, fontSize: fontSize.xs, fontFamily: fontFamily.medium },
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
  quickPromptText: { color: colors.textSecondary, fontSize: fontSize.sm, fontFamily: fontFamily.regular },
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
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
    fontFamily: fontFamily.regular,
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
  sendBtnDisabled: { backgroundColor: colors.border },
  sendIcon: { color: '#FFFFFF', fontSize: fontSize.lg, fontWeight: '700' },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.md : spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  recordingCancelBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCancelIcon: { color: colors.textMuted, fontSize: fontSize.md, fontWeight: '700' },
  recordingIndicator: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.error,
  },
  recordingTime: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.semiBold },
  recordingHint: { color: colors.textMuted, fontSize: fontSize.sm, fontFamily: fontFamily.regular },
  recordingStopBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingStopIcon: { color: '#FFFFFF', fontSize: fontSize.lg, fontWeight: '700' },
});
