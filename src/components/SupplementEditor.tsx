/**
 * SupplementEditor — formulario de un suplemento, en bottom sheet.
 *
 * Sirve para crear desde cero o editar uno existente. Permite cambiar:
 *   · nombre y emoji,
 *   · nutriente al que aporta (qué micro suma al VeganScore o "ninguno"),
 *   · dosis (cantidad + unidad).
 *
 * Es la forma "premium" de gestionar suplementos — la lista del Diario sólo
 * marca tomas, todo lo demás se ajusta aquí.
 *
 * Fase 3 del P0 de unidades de suplementos: el selector de unidad, su valor
 * por defecto y la validación al guardar usan la única fuente de verdad de
 * `@/utils/supplementUnits` — ver docs/UNIDADES-SUPLEMENTOS.md. Este
 * fichero nunca reimplementa esa lógica ni la duplica.
 */
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import {
  compatibleUnitsFor,
  normalizeSupplementDose,
  resolveUnitOnNutrientChange,
  unitsMatch,
  type SupplementDoseResult,
  type SupplementDoseRejectionReason,
} from '@/utils/supplementUnits';
import { NEEDS_REVIEW_WARNING_TEXT } from '@/utils/supplementDoseCopy';
import type { Supplement, SupplementNutrientKey } from '@/types';

const EMOJIS = ['💊', '☀️', '🌊', '🧂', '🩸', '⚡', '🦴', '🌙', '🛡️', '💪', '🌈', '🦠', '🌿', '✨'];

interface NutrientOption {
  value: SupplementNutrientKey | null;
  label: string;
}

const NUTRIENT_OPTIONS: NutrientOption[] = [
  { value: null, label: 'No aporta micro registrado' },
  { value: 'vitamin_b12_mcg', label: 'Vitamina B12' },
  { value: 'vitamin_d_mcg', label: 'Vitamina D' },
  { value: 'omega3_g', label: 'Omega-3 (DHA/EPA)' },
  { value: 'iron_mg', label: 'Hierro' },
  { value: 'zinc_mg', label: 'Zinc' },
  { value: 'calcium_mg', label: 'Calcio' },
  { value: 'iodine_mcg', label: 'Yodo' },
];

/**
 * Mensajes comprensibles para cada motivo de rechazo de
 * `normalizeSupplementDose()` — nunca se muestra el nombre interno del
 * motivo (`unit_incompatible_with_nutrient`, etc.) directamente al usuario.
 */
const UNSUPPORTED_MESSAGES: Record<SupplementDoseRejectionReason, string> = {
  invalid_amount: 'Introduce una cantidad válida, mayor que cero.',
  unknown_unit: 'Esta unidad no se reconoce. Elige una de las opciones disponibles.',
  unknown_nutrient:
    'Este suplemento tiene un nutriente que la app no reconoce. Cambia el nutriente para poder guardarlo.',
  unit_incompatible_with_nutrient: 'Esta unidad no es compatible con este nutriente.',
  requires_amount_per_unit:
    'Para registrar cápsulas o gotas con este nutriente necesitas indicar cuánto nutriente contiene cada una. Esta función aún no está disponible: elige mg, mcg o g, o quita el nutriente asociado.',
};

/** Redondea a 3 decimales para evitar artefactos de coma flotante antes de formatear. */
function formatCanonicalAmount(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  // useGrouping explícito: sin él, algunos motores JS omiten el separador de
  // miles para números redondos (comprobado en este entorno de test).
  return rounded.toLocaleString('es-ES', { maximumFractionDigits: 3, useGrouping: true });
}

/**
 * Texto de equivalencia ("Equivale a 1.000 mcg de B12") a partir de un
 * resultado YA calculado por `normalizeSupplementDose()` — nunca recalcula
 * la conversión. `null` cuando no hay nada que mostrar: sin nutriente
 * asociado (no hay unidad canónica) o combinación no soportada.
 */
export function formatDosePreview(dose: SupplementDoseResult, nutrientLabel: string): string | null {
  if (dose.status === 'unsupported') return null;
  if (dose.canonicalUnit === null) return null;
  return `Equivale a ${formatCanonicalAmount(dose.canonicalAmount)} ${dose.canonicalUnit} de ${nutrientLabel}`;
}

/** Mensaje comprensible para un resultado `unsupported` — nunca expone el código interno. */
export function unsupportedMessageFor(dose: SupplementDoseResult): string | null {
  return dose.status === 'unsupported' ? UNSUPPORTED_MESSAGES[dose.reason] : null;
}

export interface SupplementDraft {
  name: string;
  emoji: string | null;
  nutrient_key: SupplementNutrientKey | null;
  dose_amount: number;
  dose_unit: string;
}

export function SupplementEditor({
  initial,
  visible,
  onClose,
  onSave,
  onDelete,
  title,
}: {
  initial: SupplementDraft;
  visible: boolean;
  onClose: () => void;
  onSave: (draft: SupplementDraft) => Promise<{ error: string | null }>;
  onDelete?: () => void;
  title?: string;
}) {
  const t = useTheme();
  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState<string>(initial.emoji ?? '💊');
  const [nutrient, setNutrient] = useState<SupplementNutrientKey | null>(initial.nutrient_key);
  const [amount, setAmount] = useState(String(initial.dose_amount));
  const [unit, setUnit] = useState(initial.dose_unit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onPickNutrient = (n: SupplementNutrientKey | null) => {
    setNutrient(n);
    // Conserva la unidad si sigue siendo compatible con el nuevo nutriente;
    // si no, cae a la canónica. Un dato ya guardado incompatible con el
    // nutriente ACTUAL no se toca aquí — sólo al cambiar de nutriente.
    setUnit((current) => resolveUnitOnNutrientChange(n, current));
  };

  // Se recalcula en cada tecla: es una llamada pura y barata a
  // normalizeSupplementDose(), la única fuente de verdad de la conversión.
  const parsedAmount = parseFloat(amount.replace(',', '.'));
  const dose: SupplementDoseResult | null =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? normalizeSupplementDose({ amount: parsedAmount, unit, nutrientKey: nutrient })
      : null;
  const nutrientLabel = NUTRIENT_OPTIONS.find((o) => o.value === nutrient)?.label ?? '';
  const preview = dose ? formatDosePreview(dose, nutrientLabel) : null;
  const inlineUnsupported = dose ? unsupportedMessageFor(dose) : null;

  const submit = async () => {
    const a = parseFloat(amount.replace(',', '.'));
    if (!name.trim()) {
      setError('Ponle un nombre.');
      return;
    }
    if (!Number.isFinite(a) || a <= 0) {
      setError('Introduce una cantidad válida.');
      return;
    }

    const result = normalizeSupplementDose({ amount: a, unit, nutrientKey: nutrient });
    if (result.status === 'unsupported') {
      setError(UNSUPPORTED_MESSAGES[result.reason]);
      return;
    }
    // 'success' o 'needs_review': se guarda SIEMPRE lo que escribió el
    // usuario, tal cual — needs_review es sólo un aviso (§06), nunca se
    // reescribe dose_amount/dose_unit con el valor canónico calculado.
    setError(null);
    setSaving(true);
    const { error: err } = await onSave({
      name: name.trim(),
      emoji,
      nutrient_key: nutrient,
      dose_amount: a,
      dose_unit: unit,
    });
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      footer={
        <View style={{ gap: spacing.sm }}>
          {error ? <Text style={{ color: semantic.danger, fontSize: 13 }}>{error}</Text> : null}
          <Button title="Guardar" onPress={submit} loading={saving} />
          {onDelete ? (
            <Pressable
              onPress={() => {
                onDelete();
                onClose();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.xs,
              }}
            >
              <Ionicons name={'trash-outline' as never} size={16} color={semantic.danger} />
              <Text style={{ color: semantic.danger, fontWeight: '700', fontSize: 14 }}>
                Eliminar suplemento
              </Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: t.text }}>
          {title ?? 'Suplemento'}
        </Text>

        {/* Emoji + nombre */}
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: t.primarySoft,
              borderWidth: 2,
              borderColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 26 }}>{emoji}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: t.textSecondary, fontSize: 12, fontWeight: '600' }}>Nombre</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Vitamina B12 cianocobalamina"
              placeholderTextColor={t.textMuted}
              accessibilityLabel="Nombre del suplemento"
              style={{
                backgroundColor: t.inputBg,
                borderColor: t.inputBorder,
                borderWidth: 1,
                borderRadius: radii.lg,
                paddingHorizontal: spacing.md,
                paddingVertical: 10,
                fontSize: 15,
                fontWeight: '600',
                color: t.text,
              }}
            />
          </View>
        </View>

        {/* Emoji picker */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: t.textSecondary, fontSize: 12, fontWeight: '600' }}>Icono</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {EMOJIS.map((e) => {
              const active = e === emoji;
              return (
                <Pressable
                  key={e}
                  onPress={() => setEmoji(e)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Icono ${e}`}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radii.md,
                    borderWidth: 1.5,
                    borderColor: active ? t.primary : t.cardBorder,
                    backgroundColor: active ? t.primarySoft : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 18 }}>{e}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Nutriente */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: t.textSecondary, fontSize: 12, fontWeight: '600' }}>Aporta a</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {NUTRIENT_OPTIONS.map((n) => {
              const active = n.value === nutrient;
              return (
                <Pressable
                  key={n.label}
                  onPress={() => onPickNutrient(n.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={n.label}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: 9,
                    borderRadius: radii.pill,
                    borderWidth: 1.5,
                    borderColor: active ? t.primary : t.cardBorder,
                    backgroundColor: active ? t.primarySoft : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: active ? t.primary : t.textSecondary,
                    }}
                  >
                    {n.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Dosis */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: t.textSecondary, fontSize: 12, fontWeight: '600' }}>Dosis por toma</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              selectTextOnFocus
              placeholder="25"
              placeholderTextColor={t.textMuted}
              accessibilityLabel="Cantidad"
              style={{
                flex: 1,
                backgroundColor: t.inputBg,
                borderColor: t.inputBorder,
                borderWidth: 1,
                borderRadius: radii.lg,
                paddingHorizontal: spacing.md,
                paddingVertical: 10,
                fontSize: 17,
                fontWeight: '700',
                color: t.text,
              }}
            />
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Unidad"
              style={{
                flexDirection: 'row',
                backgroundColor: t.background,
                borderRadius: radii.pill,
                padding: 3,
                gap: 2,
                borderWidth: 1,
                borderColor: t.cardBorder,
              }}
            >
              {/* Sólo las unidades compatibles con el nutriente seleccionado
                  (única fuente de verdad: compatibleUnitsFor). Se compara por
                  alias (unitsMatch), no por texto exacto, para que una unidad
                  heredada de datos antiguos (p. ej. 'μg') siga mostrándose
                  como seleccionada en vez de parecer que no hay nada activo. */}
              {compatibleUnitsFor(nutrient).map((u) => {
                const active = unitsMatch(unit, u);
                return (
                  <Pressable
                    key={u}
                    onPress={() => setUnit(u)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Unidad ${u}`}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 10,
                      borderRadius: radii.pill,
                      backgroundColor: active ? t.card : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: active ? t.primary : t.textMuted,
                      }}
                    >
                      {u}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {preview ? (
            <Text style={{ color: t.textSecondary, fontSize: 12 }}>{preview}</Text>
          ) : null}

          {dose?.status === 'needs_review' ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <Ionicons name={'alert-circle-outline' as never} size={15} color={semantic.warning} style={{ marginTop: 1 }} />
              <Text style={{ color: semantic.warning, fontSize: 12, fontWeight: '600', flex: 1 }}>
                {NEEDS_REVIEW_WARNING_TEXT}
              </Text>
            </View>
          ) : null}

          {inlineUnsupported ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
              <Ionicons name={'close-circle-outline' as never} size={15} color={semantic.danger} style={{ marginTop: 1 }} />
              <Text style={{ color: semantic.danger, fontSize: 12, fontWeight: '600', flex: 1 }}>
                No se puede guardar: {inlineUnsupported}
              </Text>
            </View>
          ) : null}

          <Text style={{ color: t.textMuted, fontSize: 11 }}>
            Solo lo que tomas en una vez. Si tomas dos veces al día, añádelo como dos suplementos.
          </Text>
        </View>

      </View>
    </BottomSheet>
  );
}
