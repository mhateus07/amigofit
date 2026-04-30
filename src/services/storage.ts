import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, UserProfile, ExtractedData } from '../types';

// ── Config ────────────────────────────────────────────────
const API_BASE = 'http://31.97.160.94:3001';
const LOCAL_KEYS = {
  USER_ID: 'amigofit_user_id',
  API_KEY: 'amigofit_api_key',
};

// ── User ID (UUID stored locally, identifies this device) ─
async function getUserId(): Promise<string> {
  let id = await AsyncStorage.getItem(LOCAL_KEYS.USER_ID);
  if (!id) {
    id = 'user_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    await AsyncStorage.setItem(LOCAL_KEYS.USER_ID, id);
  }
  return id;
}

async function headers(): Promise<Record<string, string>> {
  const userId = await getUserId();
  const apiKey = await AsyncStorage.getItem(LOCAL_KEYS.API_KEY);
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

// ── Messages ──────────────────────────────────────────────
async function getMessages(): Promise<Message[]> {
  try {
    const res = await fetch(`${API_BASE}/api/messages`, { headers: await headers() });
    const data = await res.json();
    return data.messages || [];
  } catch {
    return [];
  }
}

async function saveMessages(messages: Message[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/messages`, {
      method: 'POST',
      headers: await headers(),
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
    const res = await fetch(`${API_BASE}/api/profile`, { headers: await headers() });
    const data = await res.json();
    return data.profile || null;
  } catch {
    return null;
  }
}

async function saveProfile(profile: UserProfile): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify(profile),
    });
  } catch { /* silent */ }
}

// ── Extracted Data ────────────────────────────────────────
async function getExtractedData(): Promise<ExtractedData[]> {
  try {
    const res = await fetch(`${API_BASE}/api/extracted-data`, { headers: await headers() });
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function addExtractedData(data: ExtractedData[]): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/extracted-data`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ data }),
    });
  } catch { /* silent */ }
}

// ── API Key (stays local only, never sent to DB) ──────────
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
