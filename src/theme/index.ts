/**
 * Tema de Vegetrack Mobile.
 *
 * Identidad de marca: verde bosque profundo + crema cálido + tipografía
 * serif editorial (Instrument Serif para títulos). Inspirada en la landing
 * de producto: cálida, sobria y específica para nutrición vegana consciente.
 */
import { useColorScheme } from 'react-native';
import { useThemeStore } from '@/stores/themeStore';

// Verde bosque (paleta cálida, no el verde brillante genérico).
export const brand = {
  50: '#eef4ef',
  100: '#d8e6dd',
  200: '#b2cdbd',
  300: '#84ad96',
  400: '#568a6f',
  500: '#3a6f53',
  600: '#2f5d41', // primary — el verde del logo
  700: '#264a35',
  800: '#1e3a2a',
  900: '#152a1f',
  950: '#0b1812',
} as const;

// Crema / arena cálida (sustituye los grises fríos por neutros cálidos).
export const surface = {
  0: '#ffffff',
  50: '#f7f6f1', // papel cálido
  100: '#efece4',
  200: '#e4e0d4',
  300: '#cfc9ba',
  400: '#a8a294',
  500: '#807a6c',
  600: '#5d574b',
  700: '#403c33',
  800: '#262b25', // gris-verde oscuro cálido
  900: '#1a201b',
  950: '#101713',
} as const;

export const semantic = {
  success: '#2f5d41',
  warning: '#c98a2b',
  orange: '#cc7a3b',
  danger: '#c0473e',
  protein: '#3f6ea8',
  carbs: '#c98a2b',
  fat: '#8a6bb0',
  cream: '#f3efe3',
} as const;

/** Familias tipográficas. `display` se carga en App.tsx (Instrument Serif). */
export const fonts = {
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
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
  cardBorder: '#e6e2d6',
  text: '#1a2a20',
  textSecondary: '#4a5249',
  textMuted: '#8a8577',
  primary: brand[600],
  primarySoft: '#e2ede5',
  inputBg: surface[0],
  inputBorder: '#e6e2d6',
  separator: '#eeeae0',
};

export const darkTheme: Theme = {
  dark: true,
  background: surface[950],
  card: surface[900],
  cardBorder: '#2a322b',
  text: '#eef2ea',
  textSecondary: '#c2ccc0',
  textMuted: '#8a958a',
  primary: brand[400],
  primarySoft: '#1d2a20',
  inputBg: '#161d18',
  inputBorder: '#2a322b',
  separator: '#262f27',
};

export function useTheme(): Theme {
  // El sistema dicta cuando la preferencia es 'system'; en otro caso, override.
  const scheme = useColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const resolved = preference === 'system' ? scheme : preference;
  return resolved === 'dark' ? darkTheme : lightTheme;
}

export const radii = { sm: 12, md: 16, lg: 24, xl: 28, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
