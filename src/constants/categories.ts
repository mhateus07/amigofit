import { ExtractedData } from '../types';

export interface CategoryConfig {
  icon: string;
  color: string;
  label: string;
  bg: string;
}

export const CATEGORY_CONFIG: Record<ExtractedData['category'], CategoryConfig> = {
  sleep:       { icon: '🌙', color: '#9C7FE8', label: 'Sono',        bg: 'rgba(156,127,232,0.12)' },
  nutrition:   { icon: '🥗', color: '#FF7B7B', label: 'Alimentação', bg: 'rgba(255,123,123,0.12)' },
  performance: { icon: '🏋️', color: '#00C853', label: 'Performance', bg: 'rgba(0,200,83,0.12)'    },
  mood:        { icon: '😊', color: '#FFB300', label: 'Humor',       bg: 'rgba(255,179,0,0.12)'   },
  health:      { icon: '❤️', color: '#FF4081', label: 'Saúde',       bg: 'rgba(255,64,129,0.12)'  },
  workout:     { icon: '🔥', color: '#FF7043', label: 'Treino',      bg: 'rgba(255,112,67,0.12)'  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_CONFIG) as ExtractedData['category'][];
