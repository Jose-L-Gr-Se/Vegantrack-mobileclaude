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
 */
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { fonts, radii, semantic, spacing, useTheme } from '@/theme';
import type { Supplement, SupplementNutrientKey } from '@/types';

const EMOJIS = ['💊', '☀️', '🌊', '🧂', '🩸', '⚡', '🦴', '🌙', '🛡️', '💪', '🌈', '🦠', '🌿', '✨'];

interface NutrientOption {
  value: SupplementNutrientKey | null;
  label: string;
  defaultUnit: string;
}

const NUTRIENT_OPTIONS: NutrientOption[] = [
  { value: null, label: 'No aporta micro registrado', defaultUnit: 'mg' },
  { value: 'vitamin_b12_mcg', label: 'Vitamina B12', defaultUnit: 'mcg' },
  { value: 'vitamin_d_mcg', label: 'Vitamina D', defaultUnit: 'mcg' },
  { value: 'omega3_g', label: 'Omega-3 (DHA/EPA)', defaultUnit: 'g' },
  { value: 'iron_mg', label: 'Hierro', defaultUnit: 'mg' },
  { value: 'zinc_mg', label: 'Zinc', defaultUnit: 'mg' },
  { value: 'calcium_mg', label: 'Calcio', defaultUnit: 'mg' },
  { value: 'iodine_mcg', label: 'Yodo', defaultUnit: 'mcg' },
];

const UNITS = ['mcg', 'mg', 'g', 'UI', 'cápsula', 'gota'];

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
    // Si la unidad actual no encaja con el nutriente, sugerimos la suya.
    if (n) {
      const opt = NUTRIENT_OPTIONS.find((o) => o.value === n);
      if (opt && !['mcg', 'mg', 'g'].includes(unit)) setUnit(opt.defaultUnit);
    }
  };

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
        <Text style={{ fontFamily: fonts.display, fontSize: 24, fontWeight: '400', color: t.text }}>
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {NUTRIENT_OPTIONS.map((n) => {
              const active = n.value === nutrient;
              return (
                <Pressable
                  key={n.label}
                  onPress={() => onPickNutrient(n.value)}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: 7,
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
              {UNITS.map((u) => {
                const active = unit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => setUnit(u)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 7,
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
          <Text style={{ color: t.textMuted, fontSize: 11 }}>
            Solo lo que tomas en una vez. Si tomas dos veces al día, añádelo como dos suplementos.
          </Text>
        </View>

      </View>
    </BottomSheet>
  );
}
