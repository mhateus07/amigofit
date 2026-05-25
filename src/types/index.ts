export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  extractedData?: ExtractedData[];
  imageUri?: string;
}

export interface ExtractedData {
  category: 'sleep' | 'nutrition' | 'performance' | 'mood' | 'health' | 'workout';
  label: string;
  value: string;
  rawText: string;
  timestamp: number;
}

export interface UserProfile {
  name: string;
  goal: 'hypertrophy' | 'weight_loss' | 'conditioning' | 'health';
  level: 'beginner' | 'intermediate' | 'advanced';
  age?: number;
  weight?: number;
  height?: number;
  restrictions?: string[];
  onboardingComplete: boolean;
  weeklyWorkoutGoal?: number;
  sleepGoal?: number;
  notificationEnabled?: boolean;
  notificationTime?: string;
}

export interface Conversation {
  id: string;
  date: string;
  messages: Message[];
  summary?: string;
}

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Chat: undefined;
  Diary: undefined;
  Insights: undefined;
  Profile: undefined;
};
