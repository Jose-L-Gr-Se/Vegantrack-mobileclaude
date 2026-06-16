/** Modal de ración: gramos + tipo de comida. Común a búsqueda, frescos, recientes y custom. */
import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Button, Card, Input, Pill } from '@/components/ui';
import { radii, spacing, useTheme } from '@/theme';
import { buildEntry } from '@/utils/foodEntry';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import type { FoodPer100g, MealType } from '@/types';

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Comida',
  dinner: 'Cena',
  snack: 'Snacks',
};

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
  const t = useTheme();
  const user = useAuthStore((s) => s.user);
  const { addEntry, selectedDate } = useDiaryStore();
  const [grams, setGrams] = useState(String(initialGrams));
  const [meal, setMeal] = useState<MealType>(lockedMealType ?? 'lunch');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!food) return null;

  const confirm = async () => {
    const g = parseFloat(grams.replace(',', '.'));
    if (!Number.isFinite(g) || g <= 0) {
      setError('Introduce una cantidad válida en gramos');
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
      onAdded(`${food.food_name} añadido a ${MEAL_LABELS[meal]}`);
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
              <Text style={{ fontSize: 20, fontWeight: '700', color: t.text }}>{food.food_name}</Text>
              {food.brand ? <Text style={{ color: t.textMuted, fontSize: 13 }}>{food.brand}</Text> : null}
              {food.is_vegan ? <Pill text="Vegano ✓" /> : null}
            </View>

            <Input
              label="Cantidad (g)"
              value={grams}
              onChangeText={setGrams}
              keyboardType="numeric"
              autoFocus
            />

            <Text style={{ color: t.textSecondary, fontSize: 13 }}>
              {Math.round((food.calories * g) / 100)} kcal · P {Math.round((food.protein_g * g) / 10) / 10} g · C{' '}
              {Math.round((food.carbs_g * g) / 10) / 10} g · G {Math.round((food.fat_g * g) / 10) / 10} g
            </Text>

            {!lockedMealType && (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setMeal(m)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                      borderRadius: radii.md,
                      borderWidth: 2,
                      borderColor: meal === m ? t.primary : t.cardBorder,
                      backgroundColor: meal === m ? t.primarySoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{MEAL_ICONS[m]}</Text>
                    <Text style={{ fontSize: 10, color: t.textSecondary, fontWeight: '600' }}>
                      {MEAL_LABELS[m]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {error ? <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text> : null}
            <Button title="Añadir al diario" onPress={confirm} loading={adding} />
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
