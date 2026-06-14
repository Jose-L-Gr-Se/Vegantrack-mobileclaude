/**
 * ProductDetailSheet – bottom sheet beautified para buscar y añadir alimentos.
 * Diseño inspirado en Cronometer: imagen, 4 mini-anillos de macros, selector de
 * ración con chips, selector de comida y botón de añadir.
 */
import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Card, Pill, ProgressRing } from '@/components/ui';
import { fonts, radii, semantic, spacing, useTheme } from '@/theme';
import { buildEntry } from '@/utils/foodEntry';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { MEAL_ICONS, MEAL_LABELS } from '@/components/AddFoodModal';
import type { FoodPer100g, MealType, VeganConfidence } from '@/types';

const SERVING_PRESETS = [50, 100, 150, 200];
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

interface MacroRingProps {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: string;
}

function MacroRingChip({ label, value, target, unit, color }: MacroRingProps) {
  const t = useTheme();
  const progress = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <ProgressRing progress={progress} size={64} strokeWidth={5} color={color}>
        <Text style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: '400', color: t.text }}>{Math.round(value)}</Text>
      </ProgressRing>
      <Text style={{ color: t.textMuted, fontSize: 10, marginTop: 3 }}>{label}</Text>
      <Text style={{ color: t.textMuted, fontSize: 9 }}>{unit}</Text>
    </View>
  );
}

export function ProductDetailSheet({
  food,
  lockedMealType,
  onClose,
  onAdded,
  onShowAlternatives,
  veganConfidence,
  profile,
}: {
  food: FoodPer100g | null;
  lockedMealType?: MealType | null;
  onClose: () => void;
  onAdded: (message: string) => void;
  onShowAlternatives?: () => void;
  veganConfidence?: VeganConfidence;
  profile?: {
    calorie_target: number;
    protein_target_g: number;
    carbs_target_g: number;
    fat_target_g: number;
  } | null;
}) {
  const t = useTheme();
  const user = useAuthStore((s) => s.user);
  const { addEntry, selectedDate } = useDiaryStore();
  const [grams, setGrams] = useState('100');
  const [meal, setMeal] = useState<MealType>(lockedMealType ?? 'lunch');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!food) return null;

  const g = parseFloat(grams.replace(',', '.')) || 0;
  const scale = g / 100;

  const cal = Math.round(food.calories * scale);
  const prot = Math.round(food.protein_g * scale * 10) / 10;
  const carb = Math.round(food.carbs_g * scale * 10) / 10;
  const fat = Math.round(food.fat_g * scale * 10) / 10;

  const calTarget = profile?.calorie_target ?? 0;
  const protTarget = profile?.protein_target_g ?? 0;
  const carbTarget = profile?.carbs_target_g ?? 0;
  const fatTarget = profile?.fat_target_g ?? 0;

  const confirm = async () => {
    const parsed = parseFloat(grams.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Introduce una cantidad válida en gramos');
      return;
    }
    if (!user) return;
    setAdding(true);
    const entry = buildEntry(food, parsed, meal, selectedDate, user.id);
    const { error: err } = await addEntry(entry);
    setAdding(false);
    if (err) {
      setError(err);
    } else {
      onAdded(`${food.food_name} añadido a ${MEAL_LABELS[meal]}`);
      onClose();
    }
  };

  const showAlternativesButton =
    veganConfidence === 'low' || veganConfidence === 'unknown' || (!food.is_vegan && veganConfidence !== 'high');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={() => undefined}>
          <Card
            style={{
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingBottom: spacing.xxl,
              gap: 0,
              padding: 0,
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.separator }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg, paddingTop: spacing.sm }}
            >
              {/* Header: imagen + nombre + marca + badge */}
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                {food.image_url ? (
                  <Image
                    source={{ uri: food.image_url }}
                    style={{ width: 52, height: 52, borderRadius: radii.md }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: radii.md,
                      backgroundColor: t.separator,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 24 }}>🥫</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontFamily: fonts.display, fontSize: 19, fontWeight: '400', color: t.text }} numberOfLines={2}>
                    {food.food_name}
                  </Text>
                  {food.brand ? (
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{food.brand}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
                    {food.is_vegan ? (
                      <Pill text="Vegano ✓" color={semantic.success} />
                    ) : null}
                    {veganConfidence === 'medium' ? (
                      <Pill text="Parece vegano" color={semantic.warning} />
                    ) : veganConfidence === 'low' ? (
                      <Pill text="No vegano" color={semantic.danger} />
                    ) : veganConfidence === 'unknown' ? (
                      <Pill text="Sin datos" color="#94a3b8" />
                    ) : null}
                  </View>
                </View>
              </View>

              {/* 4 macro rings */}
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <MacroRingChip
                  label="Cal"
                  value={cal}
                  target={calTarget}
                  unit="kcal"
                  color={semantic.success}
                />
                <MacroRingChip
                  label="Prot"
                  value={prot}
                  target={protTarget}
                  unit="g"
                  color={semantic.protein}
                />
                <MacroRingChip
                  label="Carbs"
                  value={carb}
                  target={carbTarget}
                  unit="g"
                  color={semantic.carbs}
                />
                <MacroRingChip
                  label="Grasa"
                  value={fat}
                  target={fatTarget}
                  unit="g"
                  color={semantic.fat}
                />
              </View>

              {/* Cantidad */}
              <View style={{ gap: spacing.sm }}>
                <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Cantidad (g)</Text>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {SERVING_PRESETS.map((preset) => (
                    <Pressable
                      key={preset}
                      onPress={() => setGrams(String(preset))}
                      style={{
                        paddingHorizontal: spacing.md,
                        paddingVertical: 6,
                        borderRadius: radii.pill,
                        borderWidth: 1.5,
                        borderColor: parseInt(grams) === preset ? t.primary : t.cardBorder,
                        backgroundColor: parseInt(grams) === preset ? t.primarySoft : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '700',
                          color: parseInt(grams) === preset ? t.primary : t.textSecondary,
                        }}
                      >
                        {preset}g
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={grams}
                  onChangeText={(v) => {
                    setGrams(v);
                    setError(null);
                  }}
                  keyboardType="numeric"
                  style={{
                    backgroundColor: t.inputBg,
                    borderColor: t.inputBorder,
                    borderWidth: 1,
                    borderRadius: radii.lg,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: 12,
                    fontSize: 17,
                    fontWeight: '700',
                    color: t.text,
                  }}
                  placeholder="100"
                  placeholderTextColor={t.textMuted}
                />
              </View>

              {/* Selector de comida */}
              {!lockedMealType && (
                <View style={{ gap: spacing.sm }}>
                  <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Comida</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {MEAL_ORDER.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setMeal(m)}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.xs,
                          borderRadius: radii.md,
                          borderWidth: 1.5,
                          borderColor: meal === m ? t.primary : t.cardBorder,
                          backgroundColor: meal === m ? t.primarySoft : 'transparent',
                          gap: 2,
                        }}
                      >
                        <Text style={{ fontSize: 16 }}>{MEAL_ICONS[m]}</Text>
                        <Text
                          style={{
                            fontSize: 9,
                            fontWeight: '700',
                            color: meal === m ? t.primary : t.textSecondary,
                            textAlign: 'center',
                          }}
                          numberOfLines={1}
                        >
                          {MEAL_LABELS[m]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {/* Alternativas veganas */}
              {showAlternativesButton && onShowAlternatives ? (
                <Pressable
                  onPress={onShowAlternatives}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: spacing.sm,
                    paddingVertical: spacing.md,
                    borderRadius: radii.lg,
                    borderWidth: 1.5,
                    borderColor: semantic.success,
                    backgroundColor: `${semantic.success}11`,
                  }}
                >
                  <Text style={{ fontSize: 16 }}>🌱</Text>
                  <Text style={{ color: semantic.success, fontWeight: '700', fontSize: 14 }}>
                    Ver alternativas veganas
                  </Text>
                </Pressable>
              ) : null}

              {error ? (
                <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text>
              ) : null}

              <Button title="Añadir al diario" onPress={confirm} loading={adding} />
            </ScrollView>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
