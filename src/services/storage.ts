import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, UserProfile, ExtractedData, AIProvider, Meal, MealCheckin } from '../types';

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://173.212.208.109:3001';

const LOCAL_KEYS = {
  TOKEN: 'amigofit_token',
  USER: 'amigofit_user',
  PROVIDER: 'amigofit_provider',
  API_KEY_ANTHROPIC: 'amigofit_api_key',
  API_KEY_OPENAI: 'amigofit_api_key_openai',
  API_KEY_GEMINI: 'amigofit_api_key_gemini',
  API_KEY_GROQ: 'amigofit_api_key_groq',
};

const PROVIDER_KEY_MAP: Record<AIProvider, string> = {
  anthropic: LOCAL_KEYS.API_KEY_ANTHROPIC,
  openai: LOCAL_KEYS.API_KEY_OPENAI,
  gemini: LOCAL_KEYS.API_KEY_GEMINI,
  groq: LOCAL_KEYS.API_KEY_GROQ,
};

// ── Auth token ────────────────────────────────────────────
export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(LOCAL_KEYS.TOKEN);
}
export async function saveToken(token: string): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEYS.TOKEN, token);
}
export async function clearToken(): Promise<void> {
  await AsyncStorage.multiRemove([LOCAL_KEYS.TOKEN, LOCAL_KEYS.USER]);
}

export async function getStoredUser(): Promise<{ id: string; name: string; email: string } | null> {
  const raw = await AsyncStorage.getItem(LOCAL_KEYS.USER);
  return raw ? JSON.parse(raw) : null;
}
export async function saveStoredUser(user: { id: string; name: string; email: string }): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEYS.USER, JSON.stringify(user));
}

// ── AI Provider ───────────────────────────────────────────
export async function getProvider(): Promise<AIProvider> {
  const p = await AsyncStorage.getItem(LOCAL_KEYS.PROVIDER);
  return (p as AIProvider) || 'anthropic';
}
export async function saveProvider(p: AIProvider): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEYS.PROVIDER, p);
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  const provider = await getProvider();
  const apiKey = await AsyncStorage.getItem(PROVIDER_KEY_MAP[provider]);
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-provider': provider };
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

// ── Messages ──────────────────────────────────────────────
async function getMessages(): Promise<Message[]> {
  try {
    const res = await fetch(`${API_BASE}/api/messages`, { headers: await authHeaders() });
    const data = await res.json();
    return data.messages || [];
  } catch { return []; }
}
async function saveMessages(messages: Message[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/messages`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ messages }),
    });
  } catch { /* silent */ }
}
async function addMessage(message: Message): Promise<void> {
  const messages = await getMessages();
  messages.push(message);
  await saveMessages(messages);
}

// ── Profile ───────────────────────────────────────────────
async function getProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/api/profile`, { headers: await authHeaders() });
    const data = await res.json();
    return data.profile || null;
  } catch { return null; }
}
async function saveProfile(profile: UserProfile): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(profile),
    });
  } catch { /* silent */ }
}

// ── Extracted Data ────────────────────────────────────────
async function getExtractedData(): Promise<ExtractedData[]> {
  try {
    const res = await fetch(`${API_BASE}/api/extracted-data`, { headers: await authHeaders() });
    const data = await res.json();
    return data.data || [];
  } catch { return []; }
}
async function addExtractedData(data: ExtractedData[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/extracted-data`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ data }),
    });
  } catch { /* silent */ }
}

// ── Meal Plan ─────────────────────────────────────────────
async function getMealPlan(): Promise<Meal[]> {
  try {
    const res = await fetch(`${API_BASE}/api/meal-plan`, { headers: await authHeaders() });
    const data = await res.json();
    return data.meals || [];
  } catch { return []; }
}
async function saveMealPlan(meals: Meal[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/meal-plan`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ meals }),
    });
  } catch { /* silent */ }
}
async function getCheckins(date: string): Promise<MealCheckin[]> {
  try {
    const res = await fetch(`${API_BASE}/api/meal-plan/checkins?date=${date}`, { headers: await authHeaders() });
    const data = await res.json();
    return data.checkins || [];
  } catch { return []; }
}
async function checkInMeal(mealId: string, date: string, status: 'done' | 'skipped'): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/meal-plan/checkins`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ mealId, date, status }),
    });
  } catch { /* silent */ }
}

// ── API Key (per-provider) ────────────────────────────────
async function getApiKey(provider?: AIProvider): Promise<string | null> {
  const p = provider ?? await getProvider();
  return AsyncStorage.getItem(PROVIDER_KEY_MAP[p]);
}
async function saveApiKey(key: string, provider?: AIProvider): Promise<void> {
  const p = provider ?? await getProvider();
  await AsyncStorage.setItem(PROVIDER_KEY_MAP[p], key);
}
async function hasAnyApiKey(): Promise<boolean> {
  const pairs = await AsyncStorage.multiGet(Object.values(PROVIDER_KEY_MAP));
  return pairs.some(([, v]) => !!v);
}

export const storage = {
  getMessages, saveMessages, addMessage,
  getProfile, saveProfile,
  getExtractedData, addExtractedData,
  getMealPlan, saveMealPlan, getCheckins, checkInMeal,
  getApiKey, saveApiKey, hasAnyApiKey,
  getProvider, saveProvider,
};
