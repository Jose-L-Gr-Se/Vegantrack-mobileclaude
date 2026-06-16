/**
 * ProductDetailSheet — LA ficha de alimento de la app.
 *
 * Es la misma hoja para todos los flujos, de modo que el usuario ve siempre
 * la misma información y estética:
 *   · resultado de búsqueda por texto,
 *   · resultado de escaneo de código de barras,
 *   · selección desde "Recientes",
 *   · edición de una entrada ya registrada en el Diario (`editEntry`).
 *
 * Auto-enriquecido: si el alimento tiene código de barras pero le faltan los
 * indicadores ricos (Nutri/Eco/NOVA, ingredientes, imagen grande) —caso
 * típico de recientes y entradas guardadas— los recupera de OpenFoodFacts
 * (caché local, instantáneo) y los fusiona. Así la ficha es consistente.
 *
 * Sobre `BottomSheet`, que gestiona teclado, safe area y cierre por gesto.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Pill, ProgressRing } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { EcoScoreBadge, NovaBadge, NutriScoreBadge } from '@/components/ScoreBadges';
import { ScoreInfoSheet, type ScoreKind } from '@/components/ScoreInfoSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { buildEntry } from '@/utils/foodEntry';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import {
  canSuggestVeganAlternative,
  getProductByBarcode,
  getVeganConfidence,
} from '@/lib/openfoodfacts';
import { MEAL_ICONS, MEAL_LABELS } from '@/components/AddFoodModal';
import type {
  FoodLogEntry,
  FoodPer100g,
  MealType,
  OpenFoodFactsProduct,
  VeganConfidence,
} from '@/types';

const SERVING_PRESETS = [50, 100, 150, 200];
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** Convierte una entry del diario a su forma per-100g para reusar la ficha. */
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
        <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>
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
  food: foodProp,
  editEntry,
  lockedMealType,
  initialGrams,
  offProduct: offProductProp,
  onClose,
  onAdded,
  onSaved,
  onDelete,
  onShowAlternatives,
  veganConfidence,
  profile,
}: {
  /** Alimento a mostrar (modo añadir). En modo edición se ignora si hay editEntry. */
  food?: FoodPer100g | null;
  /** Si se pasa, la ficha entra en modo edición de esa entrada del diario. */
  editEntry?: FoodLogEntry | null;
  lockedMealType?: MealType | null;
  initialGrams?: number;
  offProduct?: OpenFoodFactsProduct | null;
  onClose: () => void;
  onAdded?: (message: string) => void;
  onSaved?: () => void;
  onDelete?: () => void;
  onShowAlternatives?: (product: OpenFoodFactsProduct) => void;
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
  const { addEntry, deleteEntry, selectedDate } = useDiaryStore();

  const isEdit = !!editEntry;
  const baseFood = useMemo<FoodPer100g | null>(
    () => (editEntry ? entryToPer100g(editEntry) : foodProp ?? null),
    [editEntry, foodProp]
  );

  // Estado enriquecido (scores/ingredientes/imagen) y producto OFF para alts.
  const [food, setFood] = useState<FoodPer100g | null>(baseFood);
  const [offProduct, setOffProduct] = useState<OpenFoodFactsProduct | null>(offProductProp ?? null);
  const [confidence, setConfidence] = useState<VeganConfidence | undefined>(veganConfidence);

  const [grams, setGrams] = useState(String(initialGrams ?? editEntry?.serving_size_g ?? 100));
  const [meal, setMeal] = useState<MealType | null>(
    lockedMealType ?? editEntry?.meal_type ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const [infoKind, setInfoKind] = useState<ScoreKind | null>(null);

  // Auto-enriquecido por código de barras (recientes / entradas guardadas).
  useEffect(() => {
    setFood(baseFood);
    if (!baseFood) return;
    const needsRich =
      !baseFood.nutriscore_grade && !baseFood.ecoscore_grade && !baseFood.nova_group && !baseFood.ingredients_text;
    if (!offProductProp && baseFood.barcode && baseFood.source === 'openfoodfacts' && needsRich) {
      let cancelled = false;
      void getProductByBarcode(baseFood.barcode).then((p) => {
        if (cancelled || !p) return;
        setOffProduct(p);
        setConfidence(getVeganConfidence(p));
        setFood((prev) =>
          prev
            ? {
                ...prev,
                nutriscore_grade: p.nutriscore_grade ?? prev.nutriscore_grade ?? null,
                ecoscore_grade: p.ecoscore_grade ?? prev.ecoscore_grade ?? null,
                nova_group: p.nova_group ?? prev.nova_group ?? null,
                ingredients_text: p.ingredients_text ?? prev.ingredients_text ?? null,
                image_large_url: p.image_front_large_url ?? prev.image_large_url ?? null,
              }
            : prev
        );
      });
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFood]);

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

  const commit = async () => {
    const parsed = parseFloat(grams.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Introduce una cantidad válida en gramos');
      return;
    }
    const target = lockedMealType ?? meal;
    if (!target) {
      setError('Elige a qué comida añadirlo (desayuno, comida, cena o snack).');
      return;
    }
    if (!user) return;
    setBusy(true);

    if (isEdit && editEntry) {
      // Edición = borrar la entrada actual + insertar la reescalada.
      await deleteEntry(editEntry.id);
      const next = buildEntry(food, parsed, target, editEntry.date, user.id);
      const { error: err } = await addEntry(next);
      setBusy(false);
      if (err) setError(err);
      else onSaved?.();
    } else {
      const entry = buildEntry(food, parsed, target, selectedDate, user.id);
      const { error: err } = await addEntry(entry);
      setBusy(false);
      if (err) setError(err);
      else {
        onAdded?.(`${food.food_name} añadido a ${MEAL_LABELS[target]}`);
        onClose();
      }
    }
  };

  const canAlt = !isEdit && !!offProduct && canSuggestVeganAlternative(offProduct) && !!onShowAlternatives;
  const hasAnyScore = !!(food.nutriscore_grade || food.ecoscore_grade || food.nova_group);
  const heroImage = food.image_large_url || food.image_url;

  return (
    <BottomSheet
      visible={true}
      onClose={onClose}
      footer={
        <View style={{ gap: spacing.sm }}>
          {error ? <Text style={{ color: semantic.danger, fontSize: 13 }}>{error}</Text> : null}
          <Button
            title={isEdit ? 'Guardar cambios' : 'Añadir al diario'}
            onPress={commit}
            loading={busy}
          />
          {isEdit && onDelete ? (
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
          ) : null}
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
              style={{ fontSize: 22, fontWeight: '700', color: t.text, lineHeight: 26 }}
              numberOfLines={3}
            >
              {food.food_name}
            </Text>
            {food.brand ? <Text style={{ color: t.textMuted, fontSize: 13 }}>{food.brand}</Text> : null}
            <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: 4 }}>
              {food.is_vegan ? <Pill text="Vegano ✓" color={semantic.success} /> : null}
              {confidence === 'medium' ? (
                <Pill text="Parece vegano" color={semantic.warning} />
              ) : confidence === 'low' ? (
                <Pill text="No vegano" color={semantic.danger} />
              ) : confidence === 'unknown' && !food.is_vegan ? (
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
                  <Text style={{ fontSize: 12, fontWeight: '700', color: active ? t.primary : t.textSecondary }}>
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
        {lockedMealType ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              padding: spacing.md,
              borderRadius: radii.lg,
              backgroundColor: t.primarySoft,
              borderWidth: 1,
              borderColor: t.primary,
            }}
          >
            <Text style={{ fontSize: 18 }}>{MEAL_ICONS[lockedMealType]}</Text>
            <Text style={{ flex: 1, color: t.primary, fontWeight: '700', fontSize: 14 }}>
              Se añadirá a {MEAL_LABELS[lockedMealType]}
            </Text>
            <Ionicons name={'lock-closed' as never} size={14} color={t.primary} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>
              ¿A qué comida lo añades?
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {MEAL_ORDER.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => {
                    setMeal(m);
                    setError(null);
                  }}
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

        {/* ── Alternativas veganas (solo si hay una real) ─────────── */}
        {canAlt ? (
          <Pressable
            onPress={() => offProduct && onShowAlternatives?.(offProduct)}
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

      <ScoreInfoSheet kind={infoKind} visible={infoKind !== null} onClose={() => setInfoKind(null)} />
    </BottomSheet>
  );
}
