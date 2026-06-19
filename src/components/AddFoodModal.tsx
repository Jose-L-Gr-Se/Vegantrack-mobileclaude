/** Modal de ración: gramos + tipo de comida. Común a búsqueda, frescos, recientes y custom. */
import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Pill } from '@/components/ui';
import { radii, spacing, useTheme } from '@/theme';
import { buildEntry } from '@/utils/foodEntry';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import type { FoodPer100g, MealType } from '@/types';

export const MEAL_ICONS: Record<MealType, string> = {
  breakfast: '☕',
  lunch: '🍽️',
  dinner: '🌙',
  snack: '🍎',
};

export function AddFoodModal({
  food,
  initialGrams = 100,
  lockedMealType,
  onClose,
  onAdded,
}: {
  food: FoodPer100g | null;
  initialGrams?: number;
  lockedMealType?: MealType | null;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAuthStore((s) => s.user);
  const { addEntry, selectedDate } = useDiaryStore();
  const [grams, setGrams] = useState(String(initialGrams));
  const [meal, setMeal] = useState<MealType>(lockedMealType ?? 'lunch');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!food) return null;

  const mealKeys: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

  const confirm = async () => {
    const g = parseFloat(grams.replace(',', '.'));
    if (!Number.isFinite(g) || g <= 0) {
      setError(t('product.addFoodModal.invalidAmount'));
      return;
    }
    if (!user) return;
    setAdding(true);
    const entry = buildEntry(food, g, meal, selectedDate, user.id);
    const { error: err } = await addEntry(entry);
    setAdding(false);
    if (err) {
      setError(err);
    } else {
      onAdded(t('product.addFoodModal.added', { name: food.food_name, meal: t(`meals.${meal}` as any) }));
      onClose();
    }
  };

  const g = parseFloat(grams.replace(',', '.')) || 0;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={() => undefined}>
          <Card style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, gap: spacing.lg, paddingBottom: spacing.xxl }}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>{food.food_name}</Text>
              {food.brand ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>{food.brand}</Text> : null}
              {food.is_vegan ? <Pill text={t('product.vegan')} /> : null}
            </View>

            <Input
              label={t('product.addFoodModal.amount')}
              value={grams}
              onChangeText={setGrams}
              keyboardType="numeric"
              autoFocus
            />

            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
              {Math.round((food.calories * g) / 100)} kcal · P {Math.round((food.protein_g * g) / 10) / 10} g · C{' '}
              {Math.round((food.carbs_g * g) / 10) / 10} g · G {Math.round((food.fat_g * g) / 10) / 10} g
            </Text>

            {!lockedMealType && (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {mealKeys.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMeal(m)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                      borderRadius: radii.md,
                      borderWidth: 2,
                      borderColor: meal === m ? theme.primary : theme.cardBorder,
                      backgroundColor: meal === m ? theme.primarySoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{MEAL_ICONS[m]}</Text>
                    <Text style={{ fontSize: 10, color: theme.textSecondary, fontWeight: '600' }}>
                      {t(`meals.${m}` as any)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {error ? <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text> : null}
            <Button title={t('product.addFoodModal.add')} onPress={confirm} loading={adding} />
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
