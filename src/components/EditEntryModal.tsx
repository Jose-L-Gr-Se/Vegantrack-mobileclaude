/**
 * Modal de edición de una entry del diario.
 *
 * Construido sobre `BottomSheet` para heredar el comportamiento de teclado
 * y el deslizar hacia abajo para cerrar. Reescala los nutrientes
 * proporcionalmente al cambiar gramos — más simple y respeta la fuente
 * original sin tener que volver a buscar el producto en OFF.
 */
import React, { useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { Button, Pill } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { MEAL_ICONS, MEAL_LABELS } from '@/components/AddFoodModal';
import { fonts, radii, semantic, spacing, useTheme } from '@/theme';
import { useDiaryStore } from '@/stores/diaryStore';
import { useAuthStore } from '@/stores/authStore';
import { buildEntry } from '@/utils/foodEntry';
import type { FoodLogEntry, FoodPer100g, MealType } from '@/types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Convierte una entry (valores absolutos por la ración) a su forma per-100g. */
function entryToPer100g(e: FoodLogEntry): FoodPer100g {
  const ratio = e.serving_size_g > 0 ? 100 / e.serving_size_g : 0;
  const per = (v: number | null) => (v === null ? null : v * ratio);
  return {
    food_name: e.food_name,
    brand: e.brand,
    barcode: e.barcode,
    image_url: e.image_url,
    is_vegan: e.is_vegan,
    source: e.source ?? 'manual',
    source_ref: e.source_ref ?? null,
    calories: e.calories * ratio,
    protein_g: e.protein_g * ratio,
    carbs_g: e.carbs_g * ratio,
    fat_g: e.fat_g * ratio,
    fiber_g: e.fiber_g * ratio,
    sugar_g: e.sugar_g * ratio,
    saturated_fat_g: e.saturated_fat_g * ratio,
    sodium_mg: e.sodium_mg * ratio,
    vitamin_b12_mcg: per(e.vitamin_b12_mcg),
    iron_mg: per(e.iron_mg),
    zinc_mg: per(e.zinc_mg),
    calcium_mg: per(e.calcium_mg),
    omega3_g: per(e.omega3_g),
    vitamin_d_mcg: per(e.vitamin_d_mcg),
    vitamin_b12_known: e.vitamin_b12_known,
    iron_known: e.iron_known,
    zinc_known: e.zinc_known,
    calcium_known: e.calcium_known,
    omega3_known: e.omega3_known,
    vitamin_d_known: e.vitamin_d_known,
  };
}

export function EditEntryModal({
  entry,
  onClose,
  onDelete,
}: {
  entry: FoodLogEntry;
  onClose: () => void;
  onDelete: () => void;
}) {
  const t = useTheme();
  const user = useAuthStore((s) => s.user);
  const { addEntry, deleteEntry } = useDiaryStore();

  const [grams, setGrams] = useState(String(entry.serving_size_g));
  const [meal, setMeal] = useState<MealType>(entry.meal_type);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const food = entryToPer100g(entry);
  const g = parseFloat(grams.replace(',', '.')) || 0;
  const scale = g / 100;
  const previewCal = Math.round(food.calories * scale);
  const previewProt = Math.round(food.protein_g * scale * 10) / 10;
  const previewCarb = Math.round(food.carbs_g * scale * 10) / 10;
  const previewFat = Math.round(food.fat_g * scale * 10) / 10;

  const save = async () => {
    const parsed = parseFloat(grams.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Introduce una cantidad válida en gramos');
      return;
    }
    if (!user) return;
    setSaving(true);
    // Edición = borrar la actual + insertar otra reescalada con id nuevo
    await deleteEntry(entry.id);
    const next = buildEntry(food, parsed, meal, entry.date, user.id);
    const { error: err } = await addEntry(next);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <BottomSheet
      visible={true}
      onClose={onClose}
      footer={
        <View style={{ gap: spacing.sm }}>
          {error ? <Text style={{ color: semantic.danger, fontSize: 13 }}>{error}</Text> : null}
          <Button title="Guardar cambios" onPress={save} loading={saving} />
          <Pressable
            onPress={() => {
              onDelete();
              onClose();
            }}
            style={{ alignItems: 'center', paddingVertical: spacing.xs }}
          >
            <Text style={{ color: semantic.danger, fontWeight: '700', fontSize: 14 }}>
              Eliminar del diario
            </Text>
          </Pressable>
        </View>
      }
    >
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          {entry.image_url ? (
            <Image
              source={{ uri: entry.image_url }}
              style={{ width: 64, height: 64, borderRadius: radii.md }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: radii.md,
                backgroundColor: t.separator,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 28 }}>🍽️</Text>
            </View>
          )}
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              style={{ fontFamily: fonts.display, fontSize: 20, fontWeight: '400', color: t.text }}
              numberOfLines={2}
            >
              {entry.food_name}
            </Text>
            {entry.brand ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{entry.brand}</Text> : null}
            {entry.is_vegan ? <Pill text="Vegano ✓" color={semantic.success} /> : null}
          </View>
        </View>

        {/* Macros preview */}
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.md,
            backgroundColor: t.background,
            borderRadius: radii.lg,
            padding: spacing.md,
          }}
        >
          {[
            { l: 'Cal', v: previewCal, u: 'kcal' },
            { l: 'Prot', v: previewProt, u: 'g' },
            { l: 'Carbs', v: previewCarb, u: 'g' },
            { l: 'Grasa', v: previewFat, u: 'g' },
          ].map((m) => (
            <View key={m.l} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.display, fontSize: 18, fontWeight: '400', color: t.text }}>
                {m.v}
              </Text>
              <Text style={{ color: t.textMuted, fontSize: 10 }}>
                {m.l} · {m.u}
              </Text>
            </View>
          ))}
        </View>

        {/* Cantidad */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Cantidad (g)</Text>
          <TextInput
            value={grams}
            onChangeText={(v) => {
              setGrams(v);
              setError(null);
            }}
            keyboardType="numeric"
            selectTextOnFocus
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
          />
        </View>

        {/* Comida */}
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
                  }}
                  numberOfLines={1}
                >
                  {MEAL_LABELS[m]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

      </View>
    </BottomSheet>
  );
}
