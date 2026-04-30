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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Message, UserProfile } from '../types';
import { useChat } from '../hooks/useChat';
import { colors, spacing, radius, fontSize } from '../constants/theme';

interface Props {
  profile: UserProfile | null;
  apiKey: string | null;
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
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{message.content}</Text>
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
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText('');
  };

  const quickPrompts = [
    'Como foi meu treino de hoje',
    'O que comer antes de treinar?',
    'Dica de recuperação',
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerDot} />
        <Text style={styles.headerTitle}>AmigoFit</Text>
        <Text style={styles.headerSubtitle}>Seu parceiro de treino</Text>
        <TouchableOpacity onPress={clearHistory} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Limpar</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={styles.messageList}
        showsVerticalScrollIndicator={false}
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
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.inputRow}>
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
            style={[styles.sendBtn, (!inputText.trim() || isLoading) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || isLoading}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  headerDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  headerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  headerSubtitle: { color: colors.textSecondary, fontSize: fontSize.sm, marginLeft: 2, flex: 1 },
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
