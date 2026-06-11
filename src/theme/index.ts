/**
 * Tema de VeganTrack Mobile.
 * Paleta portada 1:1 de tailwind.config.js de la PWA para minimizar
 * diferencias visuales entre plataformas.
 */
import { useColorScheme } from 'react-native';

export const brand = {
  50: '#f0fdf4',
  100: '#dcfce7',
  200: '#bbf7d0',
  300: '#86efac',
  400: '#4ade80',
  500: '#22c55e',
  600: '#16a34a', // primary
  700: '#15803d',
  800: '#166534',
  900: '#14532d',
  950: '#052e16',
} as const;

export const surface = {
  0: '#ffffff',
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
  950: '#020617',
} as const;

export const semantic = {
  success: '#16a34a',
  warning: '#f59e0b',
  orange: '#f97316',
  danger: '#ef4444',
  protein: '#3b82f6',
  carbs: '#f59e0b',
  fat: '#a855f7',
} as const;

export interface Theme {
  dark: boolean;
  background: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  inputBg: string;
  inputBorder: string;
  separator: string;
}

export const lightTheme: Theme = {
  dark: false,
  background: surface[50],
  card: surface[0],
  cardBorder: surface[200],
  text: surface[900],
  textSecondary: surface[600],
  textMuted: surface[500],
  primary: brand[600],
  primarySoft: brand[100],
  inputBg: surface[0],
  inputBorder: surface[200],
  separator: surface[100],
};

export const darkTheme: Theme = {
  dark: true,
  background: surface[950],
  card: surface[800],
  cardBorder: surface[700],
  text: surface[100],
  textSecondary: surface[300],
  textMuted: surface[400],
  primary: brand[500],
  primarySoft: brand[950],
  inputBg: surface[900],
  inputBorder: surface[700],
  separator: surface[700],
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}

export const radii = { sm: 12, md: 16, lg: 24, xl: 28, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
