/**
 * ProductDetailSheet — ficha de producto antes de añadirlo al diario.
 *
 * Apoyada en `BottomSheet`, que se encarga del comportamiento de teclado y
 * del cierre por deslizamiento o por el botón de atrás.
 *
 * Objetivo: dar información suficiente para una decisión consciente sin
 * abrumar. Junto a macros y micros, mostramos cuando OFF los expone los
 * indicadores Nutri-Score, Eco-Score y NOVA. Cada uno es pulsable y abre
 * una hoja explicativa para quien no los conoce.
 */
import React, { useState } from 'react';
import {
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Pill, ProgressRing } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { EcoScoreBadge, NovaBadge, NutriScoreBadge } from '@/components/ScoreBadges';
import { ScoreInfoSheet, type ScoreKind } from '@/components/ScoreInfoSheet';
import { fonts, radii, semantic, spacing, useTheme } from '@/theme';
import { buildEntry } from '@/utils/foodEntry';
import { suggestedMealNow } from '@/utils/dates';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { MEAL_ICONS, MEAL_LABELS } from '@/components/AddFoodModal';
import type { FoodPer100g, MealType, VeganConfidence } from '@/types';

const SERVING_PRESETS = [50, 100, 150, 200];
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function MacroRingChip({
  label,
  value,
  target,
  unit,
  color,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  color: string;
}) {
  const t = useTheme();
  const progress = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <ProgressRing progress={progress} size={64} strokeWidth={5} color={color}>
        <Text style={{ fontFamily: fonts.display, fontSize: 15, fontWeight: '400', color: t.text }}>
          {Math.round(value)}
        </Text>
      </ProgressRing>
      <Text style={{ color: t.textMuted, fontSize: 10, marginTop: 3 }}>{label}</Text>
      <Text style={{ color: t.textMuted, fontSize: 9 }}>{unit}</Text>
    </View>
  );
}

function MicroRow({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  const t = useTheme();
  if (value === null || value === undefined) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: t.textSecondary, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 12, fontWeight: '700' }}>
        {value < 1 ? value.toFixed(2) : value < 10 ? value.toFixed(1) : Math.round(value)} {unit}
      </Text>
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
  // Cuando no hay lock, sugerimos la comida más probable por hora; el
  // usuario ve el selector y puede cambiarla con un toque.
  const [meal, setMeal] = useState<MealType>(lockedMealType ?? suggestedMealNow());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const [infoKind, setInfoKind] = useState<ScoreKind | null>(null);

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

  const sugars = Math.round(food.sugar_g * scale * 10) / 10;
  const satFat = Math.round(food.saturated_fat_g * scale * 10) / 10;
  const fiber = Math.round(food.fiber_g * scale * 10) / 10;
  const salt = food.salt_g != null ? Math.round(food.salt_g * scale * 100) / 100 : null;
  const sodium = Math.round(food.sodium_mg * scale);

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
    if (err) setError(err);
    else {
      onAdded(`${food.food_name} añadido a ${MEAL_LABELS[meal]}`);
      onClose();
    }
  };

  const showAlternativesButton =
    veganConfidence === 'low' || veganConfidence === 'unknown' || (!food.is_vegan && veganConfidence !== 'high');

  const hasAnyScore = !!(food.nutriscore_grade || food.ecoscore_grade || food.nova_group);
  const heroImage = food.image_large_url || food.image_url;

  return (
    <BottomSheet
      visible={true}
      onClose={onClose}
      footer={
        <View style={{ gap: spacing.sm }}>
          {error ? (
            <Text style={{ color: semantic.danger, fontSize: 13 }}>{error}</Text>
          ) : null}
          <Button title="Añadir al diario" onPress={confirm} loading={adding} />
        </View>
      }
    >
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
        {/* ── Hero ────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          {heroImage && !imageBroken ? (
            <Image
              source={{ uri: heroImage }}
              style={{ width: 96, height: 96, borderRadius: radii.lg, backgroundColor: t.separator }}
              resizeMode="cover"
              onError={() => setImageBroken(true)}
            />
          ) : (
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: radii.lg,
                backgroundColor: t.separator,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={'fast-food-outline' as never} size={36} color={t.textMuted} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4, paddingTop: 2 }}>
            <Text
              style={{ fontFamily: fonts.display, fontSize: 22, fontWeight: '400', color: t.text, lineHeight: 26 }}
              numberOfLines={3}
            >
              {food.food_name}
            </Text>
            {food.brand ? (
              <Text style={{ color: t.textMuted, fontSize: 13 }}>{food.brand}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
              {food.is_vegan ? <Pill text="Vegano ✓" color={semantic.success} /> : null}
              {veganConfidence === 'medium' ? (
                <Pill text="Parece vegano" color={semantic.warning} />
              ) : veganConfidence === 'low' ? (
                <Pill text="No vegano" color={semantic.danger} />
              ) : veganConfidence === 'unknown' && !food.is_vegan ? (
                <Pill text="Sin datos vegano" color={t.textMuted} />
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Scores (Nutri / Eco / NOVA) ─────────────────────────── */}
        {hasAnyScore ? (
          <View style={{ gap: spacing.xs }}>
            <View
              style={{
                flexDirection: 'row',
                gap: spacing.md,
                padding: spacing.md,
                backgroundColor: t.background,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: t.cardBorder,
              }}
            >
              {food.nutriscore_grade ? (
                <NutriScoreBadge grade={food.nutriscore_grade} onInfo={(k) => setInfoKind(k)} />
              ) : null}
              {food.ecoscore_grade ? (
                <EcoScoreBadge grade={food.ecoscore_grade} onInfo={(k) => setInfoKind(k)} />
              ) : null}
              {food.nova_group ? (
                <NovaBadge group={food.nova_group} onInfo={(k) => setInfoKind(k)} />
              ) : null}
            </View>
            <Text style={{ color: t.textMuted, fontSize: 11, paddingHorizontal: 2 }}>
              Toca cualquier indicador para entender qué significa.
            </Text>
          </View>
        ) : null}

        {/* ── Macros (por ración seleccionada) ────────────────────── */}
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <MacroRingChip label="Cal" value={cal} target={calTarget} unit="kcal" color={semantic.success} />
          <MacroRingChip label="Prot" value={prot} target={protTarget} unit="g" color={semantic.protein} />
          <MacroRingChip label="Carbs" value={carb} target={carbTarget} unit="g" color={semantic.carbs} />
          <MacroRingChip label="Grasa" value={fat} target={fatTarget} unit="g" color={semantic.fat} />
        </View>

        {/* ── Cantidad ────────────────────────────────────────────── */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Cantidad (g)</Text>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {SERVING_PRESETS.map((preset) => {
              const active = parseInt(grams, 10) === preset;
              return (
                <Pressable
                  key={preset}
                  onPress={() => setGrams(String(preset))}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: 6,
                    borderRadius: radii.pill,
                    borderWidth: 1.5,
                    borderColor: active ? t.primary : t.cardBorder,
                    backgroundColor: active ? t.primarySoft : 'transparent',
                  }}
                >
                  <Text
                    style={{ fontSize: 12, fontWeight: '700', color: active ? t.primary : t.textSecondary }}
                  >
                    {preset}g
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
            placeholder="100"
            placeholderTextColor={t.textMuted}
          />
        </View>

        {/* ── Selector de comida ──────────────────────────────────── */}
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

        {/* ── Detalle nutricional adicional ───────────────────────── */}
        <View
          style={{
            backgroundColor: t.background,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: t.cardBorder,
            padding: spacing.md,
            gap: 2,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              color: t.textMuted,
              textTransform: 'uppercase',
              marginBottom: spacing.xs,
            }}
          >
            Más detalle por ración
          </Text>
          <MicroRow label="Fibra" value={fiber} unit="g" />
          <MicroRow label="Azúcares" value={sugars} unit="g" />
          <MicroRow label="Grasas saturadas" value={satFat} unit="g" />
          {salt != null ? (
            <MicroRow label="Sal" value={salt} unit="g" />
          ) : sodium > 0 ? (
            <MicroRow label="Sodio" value={sodium} unit="mg" />
          ) : null}
          <MicroRow label="Hierro" value={food.iron_mg != null ? food.iron_mg * scale : null} unit="mg" />
          <MicroRow label="Calcio" value={food.calcium_mg != null ? food.calcium_mg * scale : null} unit="mg" />
          <MicroRow label="Zinc" value={food.zinc_mg != null ? food.zinc_mg * scale : null} unit="mg" />
          <MicroRow
            label="Vitamina B12"
            value={food.vitamin_b12_mcg != null ? food.vitamin_b12_mcg * scale : null}
            unit="mcg"
          />
          <MicroRow
            label="Vitamina D"
            value={food.vitamin_d_mcg != null ? food.vitamin_d_mcg * scale : null}
            unit="mcg"
          />
        </View>

        {/* ── Ingredientes ───────────────────────────────────────── */}
        {food.ingredients_text ? (
          <View
            style={{
              backgroundColor: t.background,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: t.cardBorder,
              padding: spacing.md,
              gap: 6,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.8,
                color: t.textMuted,
                textTransform: 'uppercase',
              }}
            >
              Ingredientes
            </Text>
            <Text style={{ color: t.textSecondary, fontSize: 12, lineHeight: 17 }}>
              {food.ingredients_text}
            </Text>
          </View>
        ) : null}

        {/* ── Alternativas veganas ────────────────────────────────── */}
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
            <Ionicons name={'leaf-outline' as never} size={16} color={semantic.success} />
            <Text style={{ color: semantic.success, fontWeight: '700', fontSize: 14 }}>
              Ver alternativas veganas
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Info sheet sobre Nutri/Eco/NOVA — modal por encima del modal */}
      <ScoreInfoSheet
        kind={infoKind}
        visible={infoKind !== null}
        onClose={() => setInfoKind(null)}
      />
    </BottomSheet>
  );
}
