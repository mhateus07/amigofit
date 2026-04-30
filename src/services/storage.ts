import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, UserProfile, ExtractedData } from '../types';

export const API_BASE = 'http://31.97.160.94:3001';

const LOCAL_KEYS = {
  TOKEN: 'amigofit_token',
  API_KEY: 'amigofit_api_key',
  USER: 'amigofit_user',
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

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  const apiKey = await AsyncStorage.getItem(LOCAL_KEYS.API_KEY);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
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

// ── API Key (local only) ──────────────────────────────────
async function getApiKey(): Promise<string | null> {
  return AsyncStorage.getItem(LOCAL_KEYS.API_KEY);
}
async function saveApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(LOCAL_KEYS.API_KEY, key);
}

export const storage = {
  getMessages, saveMessages, addMessage,
  getProfile, saveProfile,
  getExtractedData, addExtractedData,
  getApiKey, saveApiKey,
};
