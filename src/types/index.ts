export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  extractedData?: ExtractedData[];
  extractedAt?: number; // quando a extração de dados desta mensagem terminou
  imageId?: string; // imagem anexada, guardada no servidor (chat_images)
  imageUri?: string; // arquivo local, só enquanto o envio não terminou
  saveFailed?: boolean; // só no aparelho: a gravação no servidor falhou
}

export type ExtractedSource = 'chat' | 'manual' | 'apple_health' | 'health_connect' | 'meal_checkin' | 'workout_checkin';

export interface ExtractedData {
  id?: number;
  category: 'sleep' | 'nutrition' | 'performance' | 'mood' | 'health' | 'workout';
  label: string;
  value: string;
  rawText: string;
  timestamp: number;
  source?: ExtractedSource;
  sourceRef?: string; // identificador de origem para sincronização idempotente
  messageId?: string;
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
  aiProvider?: AIProvider;
}

export interface Conversation {
  id: string;
  date: string;
  messages: Message[];
  summary?: string;
}

export type AIProvider = 'anthropic' | 'openai' | 'gemini' | 'groq';

export interface AiInsight {
  icon: string;
  title: string;
  description: string;
  severity: 'positive' | 'warning' | 'neutral';
}

export interface Meal {
  id: string;
  name: string;
  time: string; // 'HH:mm'
  description?: string;
  items: string[];
  source: 'pdf' | 'manual';
}

export interface MealCheckin {
  mealId: string;
  date: string; // 'YYYY-MM-DD'
  status: 'done' | 'skipped';
  checkedAt?: number;
}

export interface Exercise {
  id: string;
  name: string;
  sets?: number;
  reps?: string; // texto livre: '8-12', 'até a falha', etc.
  load?: string; // texto livre: '20kg', 'peso corporal', etc.
  restSeconds?: number;
  notes?: string;
  videoId?: string; // referencia exercise_videos.id
}

export interface WorkoutPlan {
  id: string;
  name: string; // 'Treino A - Peito/Tríceps'
  dayLabel?: string;
  exercises: Exercise[];
  source: 'pdf' | 'photo' | 'manual';
}

// Uma série realizada (registro do que foi feito, não do planejado).
export interface LoggedSet {
  reps: number | null;
  loadKg: number | null;
}

export interface ExerciseSessionHistory {
  date: string; // 'YYYY-MM-DD'
  maxLoadKg: number | null;
  repsAtMax: number | null;
  sets: number;
  totalReps: number;
  volumeKg: number;
}

export interface WorkoutCheckin {
  workoutPlanId: string;
  date: string; // 'YYYY-MM-DD'
  status: 'done' | 'skipped';
  checkedAt?: number;
}

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Chat: undefined;
  Diary: undefined;
  Dieta: undefined;
  Insights: undefined;
  Profile: undefined;
};
