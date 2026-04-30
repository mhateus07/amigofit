import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, UserProfile, ExtractedData } from '../types';

const KEYS = {
  MESSAGES: 'amigofit_messages',
  PROFILE: 'amigofit_profile',
  EXTRACTED_DATA: 'amigofit_extracted_data',
  API_KEY: 'amigofit_api_key',
};

export const storage = {
  async getMessages(): Promise<Message[]> {
    const raw = await AsyncStorage.getItem(KEYS.MESSAGES);
    return raw ? JSON.parse(raw) : [];
  },

  async saveMessages(messages: Message[]): Promise<void> {
    await AsyncStorage.setItem(KEYS.MESSAGES, JSON.stringify(messages));
  },

  async addMessage(message: Message): Promise<void> {
    const messages = await this.getMessages();
    messages.push(message);
    await this.saveMessages(messages);
  },

  async getProfile(): Promise<UserProfile | null> {
    const raw = await AsyncStorage.getItem(KEYS.PROFILE);
    return raw ? JSON.parse(raw) : null;
  },

  async saveProfile(profile: UserProfile): Promise<void> {
    await AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
  },

  async getExtractedData(): Promise<ExtractedData[]> {
    const raw = await AsyncStorage.getItem(KEYS.EXTRACTED_DATA);
    return raw ? JSON.parse(raw) : [];
  },

  async addExtractedData(data: ExtractedData[]): Promise<void> {
    const existing = await this.getExtractedData();
    const updated = [...existing, ...data];
    await AsyncStorage.setItem(KEYS.EXTRACTED_DATA, JSON.stringify(updated));
  },

  async getApiKey(): Promise<string | null> {
    return AsyncStorage.getItem(KEYS.API_KEY);
  },

  async saveApiKey(key: string): Promise<void> {
    await AsyncStorage.setItem(KEYS.API_KEY, key);
  },
};
