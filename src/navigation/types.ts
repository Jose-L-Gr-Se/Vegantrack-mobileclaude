import type { NavigatorScreenParams } from '@react-navigation/native';
import type { MealType } from '@/types';

export type MainTabParamList = {
  Diary: undefined;
  Search: { mealType?: MealType; barcode?: string } | undefined;
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
