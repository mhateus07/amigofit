import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Switch,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserProfile, AIProvider } from '../types';
import { storage, AiKeyStatus } from '../services/storage';
import { errorMessage } from '../services/api';
import { reprocessHistory } from '../services/reprocess';
import { syncHealthConnect, getLastSyncTime } from '../services/healthConnect';
import { syncAppleHealth, getLastAppleHealthSyncTime } from '../services/appleHealth';
import { scheduleWorkoutReminder, cancelWorkoutReminder } from '../services/reminders';
import { colors, spacing, radius, fontSize, fontFamily } from '../constants/theme';

const PROVIDER_INFO: Record<AIProvider, { label: string; icon: string; prefix: string; hint: string; model: string }> = {
  anthropic: { label: 'Anthropic', icon: '🟣', prefix: 'sk-ant-', hint: 'console.anthropic.com', model: 'Claude Sonnet' },
  openai:    { label: 'OpenAI',    icon: '🟢', prefix: 'sk-',     hint: 'platform.openai.com',  model: 'GPT-4o' },
  groq:      { label: 'Groq',      icon: '⚡',  prefix: 'gsk_',    hint: 'console.groq.com',     model: 'GPT-OSS 20B' },
  gemini:    { label: 'Gemini',    icon: '🔵', prefix: 'AIza',    hint: 'aistudio.google.com',  model: 'Gemini 2.5 Flash' },
};

const PROVIDERS = Object.keys(PROVIDER_INFO) as AIProvider[];

interface Props {
  profile: UserProfile | null;
  authUser: { id: string; name: string; email: string } | null;
  onProfileUpdate: (profile: UserProfile) => void;
  onLogout: () => void;
}

const GOALS = [
  { value: 'hypertrophy', label: 'Hipertrofia' },
  { value: 'weight_loss', label: 'Emagrecimento' },
  { value: 'conditioning', label: 'Condicionamento' },
  { value: 'health', label: 'Saúde geral' },
] as const;

const LEVELS = [
  { value: 'beginner', label: 'Iniciante' },
  { value: 'intermediate', label: 'Intermediário' },
  { value: 'advanced', label: 'Avançado' },
] as const;

// Pede senha (e opcionalmente uma nova) — Alert.prompt só existe no iOS.
function PasswordModal({
  visible, title, confirmLabel, askNew, destructive, onClose, onConfirm,
}: {
  visible: boolean;
  title: string;
  confirmLabel: string;
  askNew?: boolean;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: (current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!visible) { setCurrent(''); setNext(''); } }, [visible]);

  const submit = async () => {
    if (!current || (askNew && next.length < 6)) {
      Alert.alert('Preencha os campos', askNew ? 'A nova senha precisa ter pelo menos 6 caracteres.' : 'Digite sua senha.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(current, next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.label}>Senha atual</Text>
          <TextInput style={styles.input} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" accessibilityLabel="Senha atual" />
          {askNew && (
            <>
              <Text style={styles.label}>Nova senha</Text>
              <TextInput style={styles.input} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" accessibilityLabel="Nova senha" />
            </>
          )}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose} disabled={busy} accessibilityRole="button">
              <Text style={styles.modalCancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalConfirm, destructive && { backgroundColor: colors.error }]}
              onPress={submit}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>{confirmLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function Counter({
  label, value, onChange, unit, min = 1, max = 99,
}: {
  label: string; value: number; onChange: (v: number) => void; unit: string; min?: number; max?: number;
}) {
  return (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterControls}>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.max(min, value - 1))}>
          <Text style={styles.counterBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.counterValue}>{value}<Text style={styles.counterUnit}> {unit}</Text></Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(Math.min(max, value + 1))}>
          <Text style={styles.counterBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ProfileScreen({ profile, authUser, onProfileUpdate, onLogout }: Props) {
  const [name, setName] = useState(profile?.name ?? '');
  const [goal, setGoal] = useState<UserProfile['goal']>(profile?.goal ?? 'health');
  const [level, setLevel] = useState<UserProfile['level']>(profile?.level ?? 'beginner');
  const [age, setAge] = useState(profile?.age?.toString() ?? '');
  const [weight, setWeight] = useState(profile?.weight?.toString() ?? '');
  const [height, setHeight] = useState(profile?.height?.toString() ?? '');
  const [weeklyWorkoutGoal, setWeeklyWorkoutGoal] = useState(profile?.weeklyWorkoutGoal ?? 3);
  const [sleepGoal, setSleepGoal] = useState(profile?.sleepGoal ?? 8);
  const [notificationEnabled, setNotificationEnabled] = useState(profile?.notificationEnabled ?? false);
  const [notificationTime, setNotificationTime] = useState(profile?.notificationTime ?? '19:00');
  const [reminderSaving, setReminderSaving] = useState(false);

  // Provider & keys — as chaves ficam no servidor; aqui só sabemos quais
  // provedores têm chave (e os 4 últimos caracteres).
  const [provider, setProvider] = useState<AIProvider>(profile?.aiProvider ?? 'anthropic');
  const [aiKeys, setAiKeys] = useState<AiKeyStatus>({});
  const [keysError, setKeysError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [passwordModal, setPasswordModal] = useState<'change' | 'delete' | null>(null);

  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessProgress, setReprocessProgress] = useState('');
  const [healthSyncing, setHealthSyncing] = useState(false);
  const [healthLastSync, setHealthLastSync] = useState<Date | null>(null);
  const [appleHealthSyncing, setAppleHealthSyncing] = useState(false);
  const [appleHealthLastSync, setAppleHealthLastSync] = useState<Date | null>(null);

  const loadKeys = async () => {
    try {
      setAiKeys(await storage.getAiKeys(true));
      setKeysError(null);
    } catch (e) {
      setKeysError(errorMessage(e));
    }
  };

  useEffect(() => {
    loadKeys();
    (async () => {
      if (Platform.OS === 'android') {
        const lastSync = await getLastSyncTime();
        setHealthLastSync(lastSync);
      }
      if (Platform.OS === 'ios') {
        const lastSync = await getLastAppleHealthSyncTime();
        setAppleHealthLastSync(lastSync);
      }
    })();
  }, []);

  // Grava campos do perfil no servidor (merge) e só então atualiza o app.
  const persistProfile = async (updates: Partial<UserProfile>): Promise<boolean> => {
    try {
      const saved = await storage.saveProfile(updates);
      onProfileUpdate(saved);
      return true;
    } catch (e) {
      Alert.alert('Não foi possível salvar', errorMessage(e));
      return false;
    }
  };

  const handleProviderChange = async (p: AIProvider) => {
    const previous = provider;
    setProvider(p);
    setShowKeyInput(false);
    setEditingKey('');
    if (!(await persistProfile({ aiProvider: p }))) setProvider(previous);
  };

  const saveProviderKey = async () => {
    const key = editingKey.trim();
    const info = PROVIDER_INFO[provider];
    if (!key || !key.startsWith(info.prefix)) {
      Alert.alert('Chave inválida', `A chave deve começar com "${info.prefix}". Acesse ${info.hint}`);
      return;
    }
    setSavingKey(true);
    try {
      setAiKeys(await storage.saveApiKey(provider, key));
      await persistProfile({ aiProvider: provider });
      setEditingKey('');
      setShowKeyInput(false);
      Alert.alert('Chave salva!', `${info.label} configurado com ${info.model}.`);
    } catch (e) {
      Alert.alert('Não foi possível salvar a chave', errorMessage(e));
    } finally {
      setSavingKey(false);
    }
  };

  const removeProviderKey = async (p: AIProvider) => {
    try {
      const keys = await storage.removeApiKey(p);
      setAiKeys(keys);
      if (provider === p) {
        const fallback = PROVIDERS.find((x) => x !== p && !!keys[x]) || 'anthropic';
        setProvider(fallback);
        await persistProfile({ aiProvider: fallback });
      }
    } catch (e) {
      Alert.alert('Não foi possível remover a chave', errorMessage(e));
    }
  };

  const handleChangePassword = async (current: string, next: string) => {
    try {
      await storage.changePassword(current, next);
      setPasswordModal(null);
      Alert.alert('Senha alterada', 'Os outros aparelhos conectados precisarão entrar de novo.');
    } catch (e) {
      Alert.alert('Não foi possível alterar a senha', errorMessage(e));
    }
  };

  const handleLogoutAll = () => {
    Alert.alert('Sair de todos os aparelhos', 'Encerra a sessão em todos os aparelhos, inclusive este.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair de todos',
        style: 'destructive',
        onPress: async () => {
          try {
            await storage.logoutAllDevices();
            onLogout();
          } catch (e) {
            Alert.alert('Não foi possível encerrar as sessões', errorMessage(e));
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = async (current: string) => {
    try {
      await storage.deleteAccount(current);
      setPasswordModal(null);
      onLogout();
      Alert.alert('Conta excluída', 'Sua conta e todos os seus dados foram apagados.');
    } catch (e) {
      Alert.alert('Não foi possível excluir a conta', errorMessage(e));
    }
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Excluir conta',
      'Isso apaga definitivamente sua conta, conversas, diário, planos, vídeos e chaves de IA. Não dá para desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Continuar', style: 'destructive', onPress: () => setPasswordModal('delete') },
      ]
    );
  };

  const handleReprocess = async () => {
    if (Object.keys(aiKeys).length === 0) {
      Alert.alert('Chave não configurada', 'Configure a chave de um provedor de IA primeiro.');
      return;
    }
    setReprocessing(true);
    setReprocessProgress('Iniciando...');
    try {
      const result = await reprocessHistory((current, total) => {
        setReprocessProgress(`Processando ${current}/${total} mensagens...`);
      });
      if (result.error) {
        Alert.alert('Não foi possível reprocessar', result.error);
      } else if (result.processed === 0 && result.failed === 0) {
        Alert.alert('Tudo atualizado', 'Todas as mensagens já foram processadas.');
      } else {
        const failedText = result.failed ? `\n${result.failed} mensagem(s) falharam — tente de novo depois.` : '';
        Alert.alert('Concluído!', `${result.processed} mensagem(s) analisada(s).\n${result.dataPoints} dado(s) salvo(s) no Diário e Insights.${failedText}`);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível reprocessar o histórico.');
    } finally {
      setReprocessing(false);
      setReprocessProgress('');
    }
  };

  const handleHealthSync = async () => {
    setHealthSyncing(true);
    try {
      const result = await syncHealthConnect();
      if (result.error) {
        Alert.alert('Health Connect', result.error);
      } else {
        const msg = result.synced > 0
          ? `${result.synced} registro(s) importado(s) para o Diário e Insights.`
          : 'Nenhum dado novo encontrado desde a última sincronização.';
        Alert.alert('Sincronizado!', msg);
        const lastSync = await getLastSyncTime();
        setHealthLastSync(lastSync);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível sincronizar com o Health Connect.');
    } finally {
      setHealthSyncing(false);
    }
  };

  const handleAppleHealthSync = async () => {
    setAppleHealthSyncing(true);
    try {
      const result = await syncAppleHealth();
      if (result.error) {
        Alert.alert('Apple Saúde', result.error);
      } else {
        const msg = result.synced > 0
          ? `${result.synced} registro(s) importado(s) para o Diário e Insights.`
          : 'Nenhum dado novo encontrado desde a última sincronização.';
        Alert.alert('Sincronizado!', msg);
        const lastSync = await getLastAppleHealthSyncTime();
        setAppleHealthLastSync(lastSync);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível sincronizar com o Apple Saúde.');
    } finally {
      setAppleHealthSyncing(false);
    }
  };

  const persistNotificationSettings = async (enabled: boolean, time: string) => {
    await persistProfile({ notificationEnabled: enabled, notificationTime: time });
  };

  const handleToggleReminder = async (value: boolean) => {
    setReminderSaving(true);
    try {
      if (value) {
        const result = await scheduleWorkoutReminder(notificationTime);
        if (!result.ok) {
          Alert.alert('Não foi possível ativar', result.error ?? 'Erro desconhecido.');
          setReminderSaving(false);
          return;
        }
      } else {
        await cancelWorkoutReminder();
      }
      setNotificationEnabled(value);
      await persistNotificationSettings(value, notificationTime);
    } finally {
      setReminderSaving(false);
    }
  };

  const handleReminderTimeChange = async (time: string) => {
    setNotificationTime(time);
    if (notificationEnabled) {
      setReminderSaving(true);
      try {
        const result = await scheduleWorkoutReminder(time);
        if (!result.ok) {
          Alert.alert('Não foi possível atualizar', result.error ?? 'Erro desconhecido.');
          return;
        }
        await persistNotificationSettings(true, time);
      } finally {
        setReminderSaving(false);
      }
    } else {
      await persistNotificationSettings(false, time);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sair', 'Tem certeza que deseja sair da sua conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: onLogout },
    ]);
  };

  const saveProfile = async () => {
    if (!name.trim()) {
      Alert.alert('Nome obrigatório', 'Por favor, insira seu nome.');
      return;
    }
    // null apaga o campo no servidor (campos omitidos são mantidos).
    const num = (v: string, parse: (x: string) => number) => {
      const n = parse(v.replace(',', '.'));
      return v && Number.isFinite(n) ? n : null;
    };
    const ok = await persistProfile({
      name: name.trim(),
      goal,
      level,
      age: num(age, (x) => parseInt(x, 10)) as number | undefined,
      weight: num(weight, parseFloat) as number | undefined,
      height: num(height, (x) => parseInt(x, 10)) as number | undefined,
      weeklyWorkoutGoal,
      sleepGoal,
      notificationEnabled,
      notificationTime,
      onboardingComplete: true,
    });
    if (ok) Alert.alert('Salvo!', 'Perfil atualizado com sucesso.');
  };

  const activeProviderKey = aiKeys[provider];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Perfil</Text>

        {/* Conta */}
        {authUser && (
          <View style={styles.section}>
            <View style={styles.userRow}>
              <View style={styles.userAvatar}>
                <Text style={styles.userAvatarText}>{authUser.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{authUser.name}</Text>
                <Text style={styles.userEmail}>{authUser.email}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} accessibilityRole="button">
              <Text style={styles.logoutBtnText}>Sair da conta</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Conta e segurança */}
        {authUser && (
          <View style={styles.section}>
            <SectionHeader title="Conta e segurança" />
            <TouchableOpacity style={styles.accountRow} onPress={() => setPasswordModal('change')} accessibilityRole="button">
              <Text style={styles.accountRowText}>Alterar senha</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.accountRow} onPress={handleLogoutAll} accessibilityRole="button">
              <Text style={styles.accountRowText}>Sair de todos os aparelhos</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.accountRow} onPress={confirmDeleteAccount} accessibilityRole="button">
              <Text style={[styles.accountRowText, { color: colors.error }]}>Excluir conta e todos os dados</Text>
            </TouchableOpacity>
          </View>
        )}

        <PasswordModal
          visible={passwordModal === 'change'}
          title="Alterar senha"
          confirmLabel="Alterar"
          askNew
          onClose={() => setPasswordModal(null)}
          onConfirm={handleChangePassword}
        />
        <PasswordModal
          visible={passwordModal === 'delete'}
          title="Confirme sua senha para excluir a conta"
          confirmLabel="Excluir"
          destructive
          onClose={() => setPasswordModal(null)}
          onConfirm={(current) => handleDeleteAccount(current)}
        />

        {/* Configuração da IA */}
        <View style={styles.section}>
          <SectionHeader title="Configuração da IA" />
          <Text style={styles.sectionDesc}>
            Toque para trocar de provedor. Segure para remover a chave. As chaves ficam guardadas criptografadas no servidor e nunca voltam para o app.
          </Text>
          {keysError && (
            <TouchableOpacity onPress={loadKeys} accessibilityRole="button">
              <Text style={styles.keysError}>Não foi possível carregar as chaves: {keysError}. Tocar para tentar de novo.</Text>
            </TouchableOpacity>
          )}

          {/* Provider selector */}
          <View style={styles.providerGrid}>
            {PROVIDERS.map((p) => {
              const info = PROVIDER_INFO[p];
              const hasKey = !!aiKeys[p];
              const isActive = provider === p;
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.providerCard, isActive && styles.providerCardActive, !hasKey && styles.providerCardNoKey]}
                  onPress={() => handleProviderChange(p)}
                  onLongPress={() => {
                    if (!aiKeys[p]) return;
                    Alert.alert(
                      `Remover chave — ${info.label}`,
                      'Isso vai desativar este provedor.',
                      [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Remover', style: 'destructive', onPress: () => removeProviderKey(p) },
                      ]
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${info.label}${isActive ? ', em uso' : ''}${hasKey ? ', chave configurada' : ', sem chave'}`}
                  accessibilityHint="Toque para usar este provedor. Segure para remover a chave."
                  activeOpacity={0.75}
                  delayLongPress={500}
                >
                  <Text style={styles.providerIcon}>{info.icon}</Text>
                  <Text style={[styles.providerLabel, isActive && styles.providerLabelActive]}>
                    {info.label}
                  </Text>
                  {isActive && hasKey
                    ? <Text style={styles.providerActive}>Em uso</Text>
                    : hasKey
                    ? <Text style={styles.providerCheck}>✓</Text>
                    : <Text style={styles.providerNoKey}>Sem chave</Text>
                  }
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Key for selected provider */}
          {activeProviderKey && !showKeyInput ? (
            <>
              <View style={styles.apiKeyActive}>
                <Text style={styles.apiKeyActiveIcon}>✓</Text>
                <View>
                  <Text style={styles.apiKeyActiveText}>{PROVIDER_INFO[provider].label} configurado</Text>
                  <Text style={styles.apiKeyActiveModel}>{PROVIDER_INFO[provider].model} · chave terminada em {activeProviderKey.last4}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowKeyInput(true)} style={styles.changeKeyBtn}>
                <Text style={styles.changeKeyText}>Alterar chave</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>
                Chave da API — {PROVIDER_INFO[provider].label}
              </Text>
              <Text style={styles.providerHint}>Acesse: {PROVIDER_INFO[provider].hint}</Text>
              <View style={styles.apiKeyRow}>
                <TextInput
                  style={styles.apiInput}
                  value={editingKey}
                  onChangeText={setEditingKey}
                  placeholder={`${PROVIDER_INFO[provider].prefix}...`}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity style={styles.saveKeyBtn} onPress={saveProviderKey} disabled={savingKey} accessibilityRole="button">
                  <Text style={styles.saveKeyBtnText}>{savingKey ? '...' : 'Salvar'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Dados pessoais */}
        <View style={styles.section}>
          <SectionHeader title="Seus dados" />
          <Text style={styles.label}>Nome</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Como devo te chamar?"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={styles.label}>Objetivo</Text>
          <View style={styles.optionRow}>
            {GOALS.map((g) => (
              <TouchableOpacity
                key={g.value}
                style={[styles.optionBtn, goal === g.value && styles.optionBtnActive]}
                onPress={() => setGoal(g.value)}
              >
                <Text style={[styles.optionText, goal === g.value && styles.optionTextActive]}>
                  {g.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Nível</Text>
          <View style={styles.optionRow}>
            {LEVELS.map((l) => (
              <TouchableOpacity
                key={l.value}
                style={[styles.optionBtn, level === l.value && styles.optionBtnActive]}
                onPress={() => setLevel(l.value)}
              >
                <Text style={[styles.optionText, level === l.value && styles.optionTextActive]}>
                  {l.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Medidas corporais */}
        <View style={styles.section}>
          <SectionHeader title="Medidas corporais" />
          <Text style={styles.sectionDesc}>Usadas pela IA para personalizar as recomendações.</Text>
          <View style={styles.measuresRow}>
            <View style={styles.measureField}>
              <Text style={styles.label}>Idade</Text>
              <TextInput style={styles.inputSmall} value={age} onChangeText={setAge}
                placeholder="—" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={3} />
              <Text style={styles.measureUnit}>anos</Text>
            </View>
            <View style={styles.measureField}>
              <Text style={styles.label}>Peso</Text>
              <TextInput style={styles.inputSmall} value={weight} onChangeText={setWeight}
                placeholder="—" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" maxLength={5} />
              <Text style={styles.measureUnit}>kg</Text>
            </View>
            <View style={styles.measureField}>
              <Text style={styles.label}>Altura</Text>
              <TextInput style={styles.inputSmall} value={height} onChangeText={setHeight}
                placeholder="—" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={3} />
              <Text style={styles.measureUnit}>cm</Text>
            </View>
          </View>
        </View>

        {/* Metas fitness */}
        <View style={styles.section}>
          <SectionHeader title="Metas fitness" />
          <Text style={styles.sectionDesc}>Aparece como barra de progresso na tela de Insights.</Text>
          <Counter label="Treinos por semana" value={weeklyWorkoutGoal} onChange={setWeeklyWorkoutGoal} unit="treinos" min={1} max={14} />
          <Counter label="Meta de sono" value={sleepGoal} onChange={setSleepGoal} unit="h/noite" min={4} max={12} />
        </View>

        {/* Notificações */}
        <View style={styles.section}>
          <SectionHeader title="Lembrete de treino" />
          <View style={styles.reminderToggleRow}>
            <Text style={[styles.sectionDesc, styles.reminderDescText]}>
              Notificação diária pra você registrar treino, refeições ou como tá se sentindo.
            </Text>
            <Switch
              value={notificationEnabled}
              onValueChange={handleToggleReminder}
              disabled={reminderSaving}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
          {notificationEnabled && (
            <View style={styles.optionRow}>
              {['07:00', '12:00', '19:00', '21:00'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.optionBtn, notificationTime === t && styles.optionBtnActive]}
                  onPress={() => handleReminderTimeChange(t)}
                  disabled={reminderSaving}
                >
                  <Text style={[styles.optionText, notificationTime === t && styles.optionTextActive]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Samsung Health / Google Fit */}
        {Platform.OS === 'android' && (
          <View style={styles.section}>
            <SectionHeader title="Samsung Health / Google Fit" />
            <Text style={styles.sectionDesc}>
              Importa sono, passos, treinos e batimentos diretamente para o Diário e Insights, sem precisar digitar nada.
            </Text>
            {healthLastSync && (
              <Text style={styles.lastSyncText}>
                Última sync: {healthLastSync.toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.healthSyncBtn, healthSyncing && styles.reprocessBtnDisabled]}
              onPress={handleHealthSync}
              disabled={healthSyncing}
            >
              {healthSyncing ? (
                <View style={styles.reprocessRow}>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={styles.healthSyncBtnText}>Sincronizando...</Text>
                </View>
              ) : (
                <Text style={styles.healthSyncBtnText}>
                  {healthLastSync ? 'Sincronizar agora' : 'Conectar e sincronizar'}
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.healthNote}>
              Requer build nativo (expo run:android). Compatível com Samsung Health, Google Fit e qualquer app que sincronize com Health Connect.
            </Text>
          </View>
        )}

        {/* Apple Saúde (iOS) */}
        {Platform.OS === 'ios' && (
          <View style={styles.section}>
            <SectionHeader title="Apple Saúde" />
            <Text style={styles.sectionDesc}>
              Importa sono, passos, treinos, peso e frequência cardíaca do Apple Saúde diretamente para o Diário e Insights, sem precisar digitar nada.
            </Text>
            {appleHealthLastSync && (
              <Text style={styles.lastSyncText}>
                Última sync: {appleHealthLastSync.toLocaleString('pt-BR', {
                  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.healthSyncBtn, appleHealthSyncing && styles.reprocessBtnDisabled]}
              onPress={handleAppleHealthSync}
              disabled={appleHealthSyncing}
            >
              {appleHealthSyncing ? (
                <View style={styles.reprocessRow}>
                  <ActivityIndicator size="small" color="#000" />
                  <Text style={styles.healthSyncBtnText}>Sincronizando...</Text>
                </View>
              ) : (
                <Text style={styles.healthSyncBtnText}>
                  {appleHealthLastSync ? 'Sincronizar agora' : 'Conectar e sincronizar'}
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.healthNote}>
              Requer build nativo (expo run:ios). Compatível com qualquer app que sincronize com o Apple Saúde (Apple Watch, Strava, etc.).
            </Text>
          </View>
        )}

        {/* Botão salvar */}
        <TouchableOpacity style={styles.saveBtn} onPress={saveProfile}>
          <Text style={styles.saveBtnText}>Salvar perfil</Text>
        </TouchableOpacity>

        {/* Reprocessar histórico */}
        <View style={styles.section}>
          <SectionHeader title="Histórico de conversas" />
          <Text style={styles.sectionDesc}>
            Processa todas as mensagens antigas e extrai dados relevantes para o Diário e Insights.
          </Text>
          <TouchableOpacity
            style={[styles.reprocessBtn, reprocessing && styles.reprocessBtnDisabled]}
            onPress={handleReprocess}
            disabled={reprocessing}
          >
            {reprocessing ? (
              <View style={styles.reprocessRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.reprocessBtnText}>{reprocessProgress}</Text>
              </View>
            ) : (
              <Text style={styles.reprocessBtnText}>Processar histórico agora</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  keysError: { color: colors.error, fontSize: fontSize.sm, marginBottom: spacing.sm },
  accountRow: { paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  accountRowText: { color: colors.text, fontSize: fontSize.md, fontFamily: fontFamily.medium },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: fontSize.lg, fontFamily: fontFamily.semiBold, marginBottom: spacing.sm },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancel: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.textSecondary, fontFamily: fontFamily.semiBold },
  modalConfirm: { flex: 1, minHeight: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  modalConfirmText: { color: '#fff', fontFamily: fontFamily.semiBold },
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  title: { color: colors.text, fontSize: fontSize.xxl, fontWeight: '700', marginBottom: spacing.lg },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.xs },
  sectionDesc: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing.md },

  // Provider selector
  providerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  providerCard: {
    flex: 1, minWidth: '45%', alignItems: 'center', paddingVertical: spacing.md,
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, gap: 4,
  },
  providerCardActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,200,83,0.06)' },
  providerCardNoKey: { opacity: 0.55 },
  providerIcon: { fontSize: 20 },
  providerLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  providerLabelActive: { color: colors.primary },
  providerCheck: { color: colors.primary, fontSize: 10, fontWeight: '700' },
  providerActive: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  providerNoKey: { color: colors.textMuted, fontSize: 9, fontWeight: '500' },
  providerHint: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: spacing.sm },

  // API key
  apiKeyRow: { flexDirection: 'row', gap: spacing.sm },
  apiInput: {
    flex: 1, backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, fontSize: fontSize.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  saveKeyBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, justifyContent: 'center',
  },
  saveKeyBtnText: { color: '#000', fontWeight: '700' },
  apiKeyActive: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(0,200,83,0.1)', borderRadius: radius.md, padding: spacing.sm,
  },
  apiKeyActiveIcon: { color: colors.primary, fontSize: fontSize.lg, fontWeight: '700' },
  apiKeyActiveText: { color: colors.primary, fontWeight: '600' },
  apiKeyActiveModel: { color: 'rgba(0,200,83,0.7)', fontSize: fontSize.xs },
  changeKeyBtn: { marginTop: spacing.sm },
  changeKeyText: { color: colors.textSecondary, fontSize: fontSize.sm, textDecorationLine: 'underline' },

  label: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, color: colors.text, fontSize: fontSize.md,
    borderWidth: 1, borderColor: colors.border,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  optionBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.surfaceElevated,
    borderWidth: 1, borderColor: colors.border,
  },
  optionBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.textSecondary, fontSize: fontSize.sm },
  optionTextActive: { color: '#000', fontWeight: '700' },

  // Medidas
  measuresRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  measureField: { flex: 1, alignItems: 'center' },
  inputSmall: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, fontSize: fontSize.lg,
    borderWidth: 1, borderColor: colors.border,
    textAlign: 'center', width: '100%', fontWeight: '700',
  },
  measureUnit: { color: colors.textMuted, fontSize: fontSize.xs, marginTop: 4 },

  // Counter
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  counterLabel: { color: colors.text, fontSize: fontSize.md, flex: 1 },
  counterControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  counterBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600', lineHeight: 22 },
  counterValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700', minWidth: 60, textAlign: 'center' },
  counterUnit: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: '400' },

  // Notificações
  reminderToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
  },
  reminderDescText: { flex: 1, marginBottom: 0 },

  // Save
  saveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginBottom: spacing.md,
  },
  saveBtnText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },

  reprocessBtn: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center',
    borderWidth: 1, borderColor: colors.primary,
  },
  reprocessBtnDisabled: { borderColor: colors.border, opacity: 0.6 },
  reprocessBtnText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  reprocessRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Health Connect
  healthSyncBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  healthSyncBtnText: { color: '#000', fontSize: fontSize.md, fontWeight: '700' },
  lastSyncText: { color: colors.textMuted, fontSize: fontSize.xs, marginBottom: spacing.xs },
  healthNote: {
    color: colors.textMuted, fontSize: fontSize.xs, lineHeight: 16,
    marginTop: spacing.sm, fontStyle: 'italic',
  },

  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  userAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  userAvatarText: { color: '#000', fontSize: fontSize.lg, fontWeight: '700' },
  userInfo: { flex: 1 },
  userName: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
  userEmail: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  logoutBtn: {
    borderRadius: radius.md, padding: spacing.sm, alignItems: 'center',
    borderWidth: 1, borderColor: colors.error,
  },
  logoutBtnText: { color: colors.error, fontSize: fontSize.sm, fontWeight: '600' },
});
