import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Message, UserProfile, ExtractedData, AIProvider, Meal, MealCheckin, AiInsight, WorkoutPlan, WorkoutCheckin,
  LoggedSet, ExerciseSessionHistory,
} from '../types';
import { API_BASE, TOKEN_KEY, AI_TIMEOUT_MS, apiRequest, newSessionEpoch, ApiError } from './api';
import { isPdfTextAvailable, extractPdfLines } from '../../modules/pdf-text';

export { API_BASE };

// Todas as funções que falam com o servidor LANÇAM erro (ApiError) em vez de
// devolver lista vazia ou fingir sucesso: quem chama decide como mostrar a
// falha e oferecer "tentar de novo".

export interface AuthUser { id: string; name: string; email: string }

const USER_KEY = 'amigofit_user';
// Chaves de IA e provedor que versões antigas do app guardavam no aparelho.
const LEGACY_AI_KEYS = ['amigofit_api_key', 'amigofit_api_key_openai', 'amigofit_api_key_gemini', 'amigofit_api_key_groq'];
const LEGACY_PROVIDER_KEYS: Record<string, AIProvider> = {
  amigofit_api_key: 'anthropic',
  amigofit_api_key_openai: 'openai',
  amigofit_api_key_gemini: 'gemini',
  amigofit_api_key_groq: 'groq',
};
const LEGACY_LOCAL_KEYS = ['amigofit_provider', 'amigofit_insights_cache', 'amigofit_apple_health_last_sync', 'amigofit_health_last_sync'];

// ── Dados locais por usuário ──────────────────────────────
// Cache e marcadores de sincronização ficam separados por conta: trocar de
// conta no mesmo aparelho nunca reaproveita dados da conta anterior.
let activeUserId: string | null = null;

export function userScopedKey(base: string): string {
  if (!activeUserId) throw new Error('Nenhum usuário ativo');
  return `${base}:${activeUserId}`;
}

const USER_SCOPED_BASES = ['amigofit_insights_cache', 'amigofit_apple_health_last_sync', 'amigofit_health_last_sync'];

// ── Sessão ────────────────────────────────────────────────
export async function getToken(): Promise<string | null> {
  const value = await SecureStore.getItemAsync(TOKEN_KEY);
  if (value !== null) return value;
  // Migração de versões que guardavam o token no AsyncStorage (texto puro).
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacy !== null) {
    await SecureStore.setItemAsync(TOKEN_KEY, legacy);
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
  return legacy;
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Início de sessão (login, cadastro ou app abrindo já logado).
export async function startSession(user: AuthUser, token?: string): Promise<void> {
  newSessionEpoch();
  activeUserId = user.id;
  aiKeysCache = null;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Logout: apaga token, usuário, caches e marcadores desta conta, e descarta
// respostas de requisições que ainda estejam a caminho.
export async function endSession(): Promise<void> {
  const userId = activeUserId;
  newSessionEpoch();
  activeUserId = null;
  aiKeysCache = null;
  const scoped = userId ? USER_SCOPED_BASES.map((b) => `${b}:${userId}`) : [];
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    ...LEGACY_AI_KEYS.map((k) => SecureStore.deleteItemAsync(k)),
    AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, ...LEGACY_AI_KEYS, ...LEGACY_LOCAL_KEYS, ...scoped]),
  ]);
}

// ── Auth ──────────────────────────────────────────────────
async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return apiRequest('/auth/login', { method: 'POST', body: { email, password }, anonymous: true });
}
async function register(name: string, email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  return apiRequest('/auth/register', { method: 'POST', body: { name, email, password }, anonymous: true });
}
async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { token } = await apiRequest<{ token: string }>('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
async function logoutAllDevices(): Promise<void> {
  await apiRequest('/auth/logout-all', { method: 'POST' });
}
async function deleteAccount(password: string): Promise<void> {
  await apiRequest('/auth/account', { method: 'DELETE', body: { password } });
}

// ── Messages ──────────────────────────────────────────────
// Página das mensagens mais recentes (antes de "before"), em ordem cronológica.
async function getMessages(options: { limit?: number; before?: number } = {}): Promise<{ messages: Message[]; hasMore: boolean }> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.before) params.set('before', String(options.before));
  const qs = params.toString();
  return apiRequest(`/api/messages${qs ? `?${qs}` : ''}`);
}
async function getAllMessages(): Promise<Message[]> {
  return (await getMessages()).messages;
}
// Grava UMA mensagem (idempotente pelo id).
async function saveMessage(message: Message): Promise<void> {
  const { id, role, content, timestamp, imageId } = message;
  await apiRequest(`/api/messages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { role, content, timestamp, imageId },
  });
}
async function clearMessages(): Promise<void> {
  await apiRequest('/api/messages', { method: 'DELETE' });
}
async function uploadChatImage(imageBase64: string, mimeType: string): Promise<string> {
  const { id } = await apiRequest<{ id: string }>('/api/chat-images', {
    method: 'POST',
    body: { imageBase64, mimeType },
    timeoutMs: 60_000,
  });
  return id;
}
export function chatImageUrl(id: string): string {
  return `${API_BASE}/api/chat-images/${id}/file`;
}

// ── Profile ───────────────────────────────────────────────
// null = a conta ainda não tem perfil (primeiro acesso). Falha de rede ou
// sessão expirada LANÇA erro — antes virava null e mandava para o onboarding.
async function getProfile(): Promise<UserProfile | null> {
  const { profile } = await apiRequest<{ profile: UserProfile | null }>('/api/profile');
  return profile;
}
// Mescla com o perfil salvo no servidor e devolve o perfil completo.
async function saveProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  const { profile } = await apiRequest<{ profile: UserProfile }>('/api/profile', { method: 'POST', body: updates });
  return profile;
}

// ── Extracted Data (Diário) ───────────────────────────────
async function getExtractedData(): Promise<ExtractedData[]> {
  const { data } = await apiRequest<{ data: ExtractedData[] }>('/api/extracted-data');
  return data;
}
async function addExtractedData(data: ExtractedData[]): Promise<number[]> {
  if (data.length === 0) return [];
  const { ids } = await apiRequest<{ ids: number[] }>('/api/extracted-data', { method: 'POST', body: { data } });
  return ids;
}
async function updateExtractedData(id: number, updates: Pick<Partial<ExtractedData>, 'category' | 'label' | 'value'>): Promise<ExtractedData> {
  const { data } = await apiRequest<{ data: ExtractedData }>(`/api/extracted-data/${id}`, { method: 'PATCH', body: updates });
  return data;
}
async function deleteExtractedData(id: number): Promise<void> {
  await apiRequest(`/api/extracted-data/${id}`, { method: 'DELETE' });
}

// ── Meal Plan ─────────────────────────────────────────────
async function getMealPlan(): Promise<Meal[]> {
  const { meals } = await apiRequest<{ meals: Meal[] }>('/api/meal-plan');
  return meals;
}
async function saveMealPlan(meals: Meal[]): Promise<void> {
  await apiRequest('/api/meal-plan', { method: 'POST', body: { meals } });
}
async function getCheckins(date: string): Promise<MealCheckin[]> {
  const { checkins } = await apiRequest<{ checkins: MealCheckin[] }>(`/api/meal-plan/checkins?date=${date}`);
  return checkins;
}
async function checkInMeal(mealId: string, date: string, status: 'done' | 'skipped'): Promise<void> {
  await apiRequest('/api/meal-plan/checkins', { method: 'POST', body: { mealId, date, status } });
}
// PDF grande (fichas de apps de personal chegam a 75 MB): envia em partes
// pequenas de binário puro. O proxy do servidor corta requisições que levam
// mais de 60s, e a internet de casa pode subir a menos de 100 KB/s — partes
// de 512 KB levam poucos segundos mesmo assim. Cada parte usa a sessão de
// segundo plano do iOS (continua se o app for minimizado) e é repetida em
// caso de falha. onProgress recebe de 0 a 1.
const CHUNK_BYTES = 512 * 1024;

export type UploadProgress = (fraction: number) => void;

async function sendChunk(uploadId: string, index: number, tmpUri: string, token: string | null): Promise<void> {
  let res: FileSystem.FileSystemUploadResult;
  try {
    res = await FileSystem.uploadAsync(`${API_BASE}/api/uploads/${uploadId}/chunks/${index}`, tmpUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError(0, 'Falha de conexão ao enviar o arquivo.');
  }
  if (res.status < 200 || res.status >= 300) {
    let message = `Erro ${res.status} ao enviar o arquivo.`;
    try { message = JSON.parse(res.body || '{}').error || message; } catch { /* corpo não-JSON (proxy) */ }
    throw new ApiError(res.status >= 500 ? 0 : res.status, message);
  }
}

async function uploadPdfInChunks(fileUri: string, onProgress?: UploadProgress): Promise<string> {
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists || !info.size) throw new ApiError(400, 'Não foi possível abrir o arquivo.');
  const size = info.size;
  const { id } = await apiRequest<{ id: string }>('/api/uploads', { method: 'POST', body: { size, mimeType: 'application/pdf' } });
  const token = await getToken();
  const tmpUri = `${FileSystem.cacheDirectory}upload-${id}.part`;
  const total = Math.ceil(size / CHUNK_BYTES);
  try {
    for (let index = 0; index < total; index++) {
      const data = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: index * CHUNK_BYTES,
        length: Math.min(CHUNK_BYTES, size - index * CHUNK_BYTES),
      });
      await FileSystem.writeAsStringAsync(tmpUri, data, { encoding: FileSystem.EncodingType.Base64 });
      // Até 5 tentativas por parte, com espera crescente; repetir é seguro.
      for (let attempt = 1; ; attempt++) {
        try {
          await sendChunk(id, index, tmpUri, token);
          break;
        } catch (e) {
          if (attempt >= 5 || !(e instanceof ApiError) || e.status !== 0) {
            throw attempt >= 5
              ? new ApiError(0, `A conexão caiu durante o envio (parte ${index + 1} de ${total}). Confira a internet e tente de novo.`)
              : e;
          }
          await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
      onProgress?.((index + 1) / total);
    }
  } finally {
    FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
  return id;
}

async function extractMealsFromPdf(fileUri: string, onProgress?: UploadProgress): Promise<Omit<Meal, 'id'>[]> {
  const id = await uploadPdfInChunks(fileUri, onProgress);
  const { meals } = await apiRequest<{ meals: Omit<Meal, 'id'>[] }>(`/api/extract-meals/upload/${id}`, { method: 'POST', timeoutMs: AI_TIMEOUT_MS });
  return meals;
}

// ── Workout Plans (fichas de treino) ───────────────────────
async function getWorkoutPlans(): Promise<WorkoutPlan[]> {
  const { plans } = await apiRequest<{ plans: WorkoutPlan[] }>('/api/workout-plans');
  return plans;
}
async function saveWorkoutPlans(plans: WorkoutPlan[]): Promise<void> {
  await apiRequest('/api/workout-plans', { method: 'POST', body: { plans } });
}
async function getWorkoutCheckins(date: string): Promise<WorkoutCheckin[]> {
  const { checkins } = await apiRequest<{ checkins: WorkoutCheckin[] }>(`/api/workout-plans/checkins?date=${date}`);
  return checkins;
}
async function checkInWorkout(workoutPlanId: string, date: string, status: 'done' | 'skipped'): Promise<void> {
  await apiRequest('/api/workout-plans/checkins', { method: 'POST', body: { workoutPlanId, date, status } });
}
// No iPhone, o texto do PDF é lido no próprio aparelho (PDFKit) e só ~5 KB
// sobem — rápido mesmo com internet lenta e PDFs de 75 MB (sem as fotos).
// Sem o módulo nativo (Android), o PDF inteiro é enviado em partes e o
// servidor lê o texto e recorta as fotos. Formato de app de personal é lido
// sem IA; outros formatos caem na IA.
async function extractWorkoutFromPdf(fileUri: string, onProgress?: UploadProgress): Promise<Omit<WorkoutPlan, 'id'>[]> {
  if (isPdfTextAvailable()) {
    const lines = await extractPdfLines(fileUri);
    onProgress?.(1);
    const { plans } = await apiRequest<{ plans: Omit<WorkoutPlan, 'id'>[] }>('/api/extract-workout/lines', {
      method: 'POST', body: { lines }, timeoutMs: AI_TIMEOUT_MS,
    });
    return plans;
  }
  const id = await uploadPdfInChunks(fileUri, onProgress);
  const { plans } = await apiRequest<{ plans: Omit<WorkoutPlan, 'id'>[] }>(`/api/extract-workout/upload/${id}`, { method: 'POST', timeoutMs: AI_TIMEOUT_MS });
  return plans;
}
async function extractWorkoutFromImage(imageBase64: string, mimeType: string): Promise<Omit<WorkoutPlan, 'id'>[]> {
  const { plans } = await apiRequest<{ plans: Omit<WorkoutPlan, 'id'>[] }>('/api/extract-workout', {
    method: 'POST', body: { imageBase64, mimeType }, timeoutMs: AI_TIMEOUT_MS,
  });
  return plans;
}

// ── Séries realizadas ─────────────────────────────────────
// exerciseId: id do exercício na ficha (ou o nome, em fichas antigas sem id).
async function getWorkoutLogs(date: string, workoutPlanId?: string): Promise<(LoggedSet & { exerciseId: string; setIndex: number })[]> {
  const qs = new URLSearchParams({ date, ...(workoutPlanId ? { workoutPlanId } : {}) });
  const { sets } = await apiRequest<{ sets: (LoggedSet & { exerciseId: string; setIndex: number })[] }>(`/api/workout-logs?${qs}`);
  return sets;
}
async function saveExerciseSets(
  workoutPlanId: string, exerciseId: string, exerciseName: string, date: string, sets: LoggedSet[]
): Promise<void> {
  await apiRequest('/api/workout-logs', { method: 'PUT', body: { workoutPlanId, exerciseId, exerciseName, date, sets } });
}
async function getExerciseHistory(exerciseName: string, limit = 12): Promise<ExerciseSessionHistory[]> {
  const qs = new URLSearchParams({ exercise: exerciseName, limit: String(limit) });
  const { history } = await apiRequest<{ history: ExerciseSessionHistory[] }>(`/api/workout-logs/history?${qs}`);
  return history;
}

// ── Exercise videos ──────────────────────────────────────────
async function uploadExerciseVideo(fileUri: string, mimeType: string): Promise<string> {
  const token = await getToken();
  let res: FileSystem.FileSystemUploadResult;
  try {
    res = await FileSystem.uploadAsync(`${API_BASE}/api/exercise-videos`, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'video',
      mimeType,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    throw new ApiError(0, 'Falha de conexão ao enviar o vídeo. Tente novamente.');
  }
  let data: { id?: string; error?: string } = {};
  try { data = JSON.parse(res.body || '{}'); } catch { /* corpo não-JSON */ }
  if (res.status < 200 || res.status >= 300 || !data.id) {
    throw new ApiError(res.status, data.error || `Erro ${res.status} ao enviar o vídeo.`);
  }
  return data.id;
}
async function deleteExerciseVideo(id: string): Promise<void> {
  await apiRequest(`/api/exercise-videos/${id}`, { method: 'DELETE' });
}
export function exerciseImageUrl(id: string): string {
  return `${API_BASE}/api/exercise-images/${id}/file`;
}
export function exerciseVideoUrl(id: string): string {
  return `${API_BASE}/api/exercise-videos/${id}/file`;
}

// ── Chaves de IA ──────────────────────────────────────────
// Ficam criptografadas no servidor, que as usa diretamente. O app só sabe
// QUAIS provedores têm chave (e os 4 últimos caracteres), nunca a chave.
export type AiKeyStatus = Partial<Record<AIProvider, { last4: string }>>;
let aiKeysCache: AiKeyStatus | null = null;

async function getAiKeys(force = false): Promise<AiKeyStatus> {
  if (aiKeysCache && !force) return aiKeysCache;
  const { keys } = await apiRequest<{ keys: AiKeyStatus }>('/api/ai-keys');
  aiKeysCache = keys;
  return keys;
}
async function saveApiKey(provider: AIProvider, apiKey: string): Promise<AiKeyStatus> {
  const { keys } = await apiRequest<{ keys: AiKeyStatus }>(`/api/ai-keys/${provider}`, { method: 'PUT', body: { apiKey } });
  aiKeysCache = keys;
  return keys;
}
async function removeApiKey(provider: AIProvider): Promise<AiKeyStatus> {
  const { keys } = await apiRequest<{ keys: AiKeyStatus }>(`/api/ai-keys/${provider}`, { method: 'DELETE' });
  aiKeysCache = keys;
  return keys;
}
async function hasAnyApiKey(): Promise<boolean> {
  return Object.keys(await getAiKeys()).length > 0;
}

// Versões anteriores guardavam as chaves no Keychain do aparelho. Envia essas
// chaves para o servidor (se ele ainda não tiver) e só então as apaga daqui.
export async function migrateLocalAiKeys(): Promise<void> {
  const serverKeys = await getAiKeys(true);
  for (const localKey of LEGACY_AI_KEYS) {
    const value = await SecureStore.getItemAsync(localKey) ?? await AsyncStorage.getItem(localKey);
    if (!value) continue;
    const provider = LEGACY_PROVIDER_KEYS[localKey];
    if (!serverKeys[provider]) await saveApiKey(provider, value);
    await SecureStore.deleteItemAsync(localKey);
    await AsyncStorage.removeItem(localKey);
  }
}

// ── Insights (IA) cache ────────────────────────────────────
// Evita gerar insights via IA a cada abertura da tela. A chave do cache é
// uma assinatura dos dados (não só a quantidade), e fica separada por conta.
export interface InsightsCache {
  date: string;
  signature: string;
  insights: AiInsight[];
}
async function getCachedInsights(): Promise<InsightsCache | null> {
  const raw = await AsyncStorage.getItem(userScopedKey('amigofit_insights_cache'));
  return raw ? JSON.parse(raw) : null;
}
async function saveCachedInsights(cache: InsightsCache): Promise<void> {
  await AsyncStorage.setItem(userScopedKey('amigofit_insights_cache'), JSON.stringify(cache));
}

export const storage = {
  login, register, changePassword, logoutAllDevices, deleteAccount,
  getMessages, getAllMessages, saveMessage, clearMessages, uploadChatImage,
  getProfile, saveProfile,
  getExtractedData, addExtractedData, updateExtractedData, deleteExtractedData,
  getMealPlan, saveMealPlan, getCheckins, checkInMeal, extractMealsFromPdf,
  getWorkoutPlans, saveWorkoutPlans, getWorkoutCheckins, checkInWorkout, extractWorkoutFromPdf, extractWorkoutFromImage,
  getWorkoutLogs, saveExerciseSets, getExerciseHistory,
  uploadExerciseVideo, deleteExerciseVideo, exerciseVideoUrl,
  getAiKeys, saveApiKey, removeApiKey, hasAnyApiKey,
  getCachedInsights, saveCachedInsights,
};
