import type { NavigatorScreenParams } from '@react-navigation/native';
import type { MealType } from '@/types';
import type { MicroKey } from '@/stores/diaryStore';

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
   *
   * `nutrient` (Nutrition Insight accionable, Dashboard): al llegar desde el
   * botón "Ver alimentos" de una prioridad de "Qué vigilar hoy", muestra un
   * aviso contextual con las mismas fuentes alimentarias que ya se ven bajo
   * la barra de ese micro — nunca ejecuta una búsqueda automática ni filtra
   * resultados por nutriente, el usuario sigue buscando y decidiendo él mismo.
   */
  Search: { mealType?: MealType; barcode?: string; fromActivation?: boolean; nutrient?: MicroKey } | undefined;
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
  /** `initialMicro` (primer Nutrition Insight, Dashboard): al llegar desde una
   *  prioridad concreta del insight, abre el gráfico ya centrado en ESE
   *  micro en vez de siempre en B12 por defecto. */
  MicroTrends: { initialMicro?: MicroKey } | undefined;
};
