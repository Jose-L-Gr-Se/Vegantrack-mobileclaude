import type { NavigatorScreenParams } from '@react-navigation/native';
import type { MealType } from '@/types';

export type MainTabParamList = {
  Diary: undefined;
  Search: { mealType?: MealType; barcode?: string } | undefined;
  Dashboard: undefined;
  Progress: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  Scanner: undefined;
  Recipes: undefined;
};
