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
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import type { Supplement, SupplementNutrientKey } from '@/types';

const EMOJIS = ['💊', '☀️', '🌊', '🧂', '🩸', '⚡', '🦴', '🌙', '🛡️', '💪', '🌈', '🦠', '🌿', '✨'];

interface NutrientOption {
  value: SupplementNutrientKey | null;
  tKey: string;
  defaultUnit: string;
}

const NUTRIENT_OPTIONS: NutrientOption[] = [
  { value: null, tKey: 'supplementEditor.nutrient.none', defaultUnit: 'mg' },
  { value: 'vitamin_b12_mcg', tKey: 'supplementEditor.nutrient.b12', defaultUnit: 'mcg' },
  { value: 'vitamin_d_mcg', tKey: 'supplementEditor.nutrient.d', defaultUnit: 'mcg' },
  { value: 'omega3_g', tKey: 'supplementEditor.nutrient.omega3', defaultUnit: 'g' },
  { value: 'iron_mg', tKey: 'supplementEditor.nutrient.iron', defaultUnit: 'mg' },
  { value: 'zinc_mg', tKey: 'supplementEditor.nutrient.zinc', defaultUnit: 'mg' },
  { value: 'calcium_mg', tKey: 'supplementEditor.nutrient.calcium', defaultUnit: 'mg' },
  { value: 'iodine_mcg', tKey: 'supplementEditor.nutrient.iodine', defaultUnit: 'mcg' },
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
  const { t } = useTranslation();
  const theme = useTheme();
  const [name, setName] = useState(initial.name);
  const [emoji, setEmoji] = useState<string>(initial.emoji ?? '💊');
  const [nutrient, setNutrient] = useState<SupplementNutrientKey | null>(initial.nutrient_key);
  const [amount, setAmount] = useState(String(initial.dose_amount));
  const [unit, setUnit] = useState(initial.dose_unit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onPickNutrient = (n: SupplementNutrientKey | null) => {
    setNutrient(n);
    if (n) {
      const opt = NUTRIENT_OPTIONS.find((o) => o.value === n);
      if (opt && !['mcg', 'mg', 'g'].includes(unit)) setUnit(opt.defaultUnit);
    }
  };

  const submit = async () => {
    const a = parseFloat(amount.replace(',', '.'));
    if (!name.trim()) {
      setError(t('supplementEditor.errorNoName'));
      return;
    }
    if (!Number.isFinite(a) || a <= 0) {
      setError(t('supplementEditor.errorBadAmount'));
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
          <Button title={t('common.save')} onPress={submit} loading={saving} />
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
                {t('supplementEditor.deleteLabel')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text }}>
          {title ?? t('supplementEditor.defaultTitle')}
        </Text>

        {/* Emoji + nombre */}
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: theme.primarySoft,
              borderWidth: 2,
              borderColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 26 }}>{emoji}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '600' }}>{t('supplementEditor.nameLabel')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Vitamina B12 cianocobalamina"
              placeholderTextColor={theme.textMuted}
              style={{
                backgroundColor: theme.inputBg,
                borderColor: theme.inputBorder,
                borderWidth: 1,
                borderRadius: radii.lg,
                paddingHorizontal: spacing.md,
                paddingVertical: 10,
                fontSize: 15,
                fontWeight: '600',
                color: theme.text,
              }}
            />
          </View>
        </View>

        {/* Emoji picker */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '600' }}>{t('supplementEditor.iconLabel')}</Text>
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
                    borderColor: active ? theme.primary : theme.cardBorder,
                    backgroundColor: active ? theme.primarySoft : 'transparent',
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
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '600' }}>{t('supplementEditor.contributesTo')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {NUTRIENT_OPTIONS.map((n) => {
              const active = n.value === nutrient;
              return (
                <Pressable
                  key={n.tKey}
                  onPress={() => onPickNutrient(n.value)}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: 7,
                    borderRadius: radii.pill,
                    borderWidth: 1.5,
                    borderColor: active ? theme.primary : theme.cardBorder,
                    backgroundColor: active ? theme.primarySoft : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: active ? theme.primary : theme.textSecondary,
                    }}
                  >
                    {t(n.tKey as any)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Dosis */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '600' }}>{t('supplementEditor.doseLabel')}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              selectTextOnFocus
              placeholder="25"
              placeholderTextColor={theme.textMuted}
              style={{
                flex: 1,
                backgroundColor: theme.inputBg,
                borderColor: theme.inputBorder,
                borderWidth: 1,
                borderRadius: radii.lg,
                paddingHorizontal: spacing.md,
                paddingVertical: 10,
                fontSize: 17,
                fontWeight: '700',
                color: theme.text,
              }}
            />
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: theme.background,
                borderRadius: radii.pill,
                padding: 3,
                gap: 2,
                borderWidth: 1,
                borderColor: theme.cardBorder,
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
                      backgroundColor: active ? theme.card : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: active ? theme.primary : theme.textMuted,
                      }}
                    >
                      {u}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
            {t('supplementEditor.doseHint')}
          </Text>
        </View>

      </View>
    </BottomSheet>
  );
}
