import type { NavigatorScreenParams } from '@react-navigation/native';
import type { MealType } from '@/types';

export type MainTabParamList = {
  /**
   * `startAction` (Bloque 1 de activación — Product Audit v2): al llegar
   * con `'photo'`, el Diario abre directamente el selector de cámara/galería
   * del análisis con IA, igual que si el usuario hubiese tocado el CTA
   * correspondiente él mismo. Se consume una sola vez (DiaryScreen limpia el
   * parámetro con `setParams` tras leerlo, mismo criterio que
   * `openSupplementId`/`openSupplements` en Profile).
   */
  Diary: { startAction?: 'photo' } | undefined;
  /**
   * `fromActivation` (Bloque 1 de activación): marca que se llegó a Buscar
   * desde la pantalla de activación post-onboarding, para que al añadir el
   * primer alimento se navegue al resumen (Dashboard) en vez de volver al
   * Diario, que es el destino normal tras un alta ya activada.
   */
  Search: { mealType?: MealType; barcode?: string; fromActivation?: boolean } | undefined;
  Dashboard: undefined;
  Progress: undefined;
  /**
   * `openSupplementId`/`openSupplements` (Fase 5 del P0 de unidades de
   * suplementos): abren la pantalla de gestión de suplementos existente al
   * llegar, opcionalmente con un suplemento concreto ya seleccionado para
   * editar — usado desde el aviso de Dashboard. Se consumen una sola vez
   * (ProfileScreen los limpia con `setParams` tras leerlos).
   */
  Profile: { openSupplementId?: string; openSupplements?: boolean } | undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  Scanner: { mealType?: MealType } | undefined;
  Recipes: undefined;
  MicroTrends: undefined;
};
