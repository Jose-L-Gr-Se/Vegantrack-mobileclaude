/** Wizard de 3 pasos: datos básicos → actividad → objetivo. Calcula objetivos con Mifflin-St Jeor. */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Input } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { fonts, radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { calculateTargets } from '@/utils/nutrition';
import type { ActivityLevel, Goal, Sex } from '@/types';

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; desc: string; icon: string }[] = [
  { value: 'sedentary', label: 'Sedentario', desc: 'Sin ejercicio', icon: '🪑' },
  { value: 'light', label: 'Ligero', desc: '1-2 días/semana', icon: '🚶' },
  { value: 'moderate', label: 'Moderado', desc: '3-4 días/semana', icon: '🚴' },
  { value: 'active', label: 'Activo', desc: '5-6 días/semana', icon: '🏋️' },
  { value: 'very_active', label: 'Muy activo', desc: 'Ejercicio intenso diario', icon: '⚡' },
];

const GOAL_OPTIONS: { value: Goal; label: string; desc: string; icon: string }[] = [
  { value: 'cut', label: 'Perder grasa', desc: 'Déficit de 500 kcal', icon: '🔥' },
  { value: 'maintain', label: 'Mantener', desc: 'Calorías de mantenimiento', icon: '⚖️' },
  { value: 'bulk', label: 'Ganar masa', desc: 'Superávit de 300 kcal', icon: '💪' },
];

const STEP_META = [
  {
    title: 'Tu punto de partida',
    subtitle: 'Calculamos tu metabolismo con la fórmula Mifflin-St Jeor',
  },
  {
    title: 'Tu ritmo de vida',
    subtitle: 'Ajustamos las calorías a tu actividad diaria',
  },
  {
    title: 'Tu objetivo',
    subtitle: 'Todo empieza con saber a dónde quieres llegar',
  },
];

function OptionRow({
  selected,
  label,
  desc,
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
  desc: string;
  icon?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        borderWidth: 1.5,
        borderColor: selected ? t.primary : t.cardBorder,
        backgroundColor: selected ? t.primarySoft : t.card,
        borderRadius: radii.lg,
        padding: spacing.lg,
      }}
    >
      {icon ? <Text style={{ fontSize: 20 }}>{icon}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: selected ? t.primary : t.text, fontSize: 15 }}>
          {label}
        </Text>
        {desc ? (
          <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 2 }}>{desc}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name={'checkmark-circle' as any} size={20} color={t.primary} />
      ) : null}
    </Pressable>
  );
}

export function OnboardingScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuthStore();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [height, setHeight] = useState(profile?.height_cm ? String(profile.height_cm) : '');
  const [weight, setWeight] = useState(profile?.weight_kg ? String(profile.weight_kg) : '');
  const [birthDate, setBirthDate] = useState(profile?.birth_date ?? '');
  const [sex, setSex] = useState<Sex | null>(profile?.sex ?? null);
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [goal, setGoal] = useState<Goal>('maintain');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const step1Valid =
    height.trim() !== '' &&
    weight.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(birthDate) &&
    sex !== null;

  const finish = async () => {
    setSaving(true);
    setError(null);
    const base = {
      display_name: name.trim() || null,
      height_cm: parseFloat(height),
      weight_kg: parseFloat(weight),
      birth_date: birthDate,
      sex,
      activity_level: activity,
      goal,
    };
    const targets = calculateTargets(base);
    if (!targets) {
      setSaving(false);
      setError('Revisa los datos: no se pudieron calcular tus objetivos.');
      return;
    }
    const { error: err } = await updateProfile({
      ...base,
      calorie_target: targets.calories,
      protein_target_g: targets.protein_g,
      carbs_target_g: targets.carbs_g,
      fat_target_g: targets.fat_g,
    });
    setSaving(false);
    if (err) setError(err);
  };

  const meta = STEP_META[step - 1];

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      {/* Branding bar */}
      <View
        style={{
          paddingTop: insets.top + spacing.md,
          paddingBottom: spacing.md,
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <Logo size={22} />
          <Text style={{ fontFamily: fonts.display, fontSize: 19, fontWeight: '400', letterSpacing: -0.3, color: t.text }}>
            VeganTrack
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxl,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Step indicator dots */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center' }}>
          {[1, 2, 3].map((s) =>
            s === step ? (
              <View
                key={s}
                style={{
                  width: 24,
                  height: 8,
                  borderRadius: radii.pill,
                  backgroundColor: t.primary,
                }}
              />
            ) : (
              <View
                key={s}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: radii.pill,
                  backgroundColor: t.separator,
                }}
              />
            )
          )}
        </View>

        {/* Step title + subtitle (outside the card) */}
        <View style={{ gap: spacing.xs }}>
          <Text style={{ fontSize: 30, fontWeight: '700', color: t.text }}>{meta.title}</Text>
          <Text style={{ fontSize: 14, color: t.textMuted, lineHeight: 20 }}>{meta.subtitle}</Text>
        </View>

        {/* Step 1: datos básicos */}
        {step === 1 && (
          <Card style={{ gap: spacing.lg }}>
            <Input
              label="Nombre"
              value={name}
              onChangeText={setName}
              placeholder="¿Cómo te llamas?"
            />
            <Input
              label="Altura (cm)"
              value={height}
              onChangeText={setHeight}
              keyboardType="numeric"
              placeholder="170"
            />
            <Input
              label="Peso (kg)"
              value={weight}
              onChangeText={setWeight}
              keyboardType="numeric"
              placeholder="65"
            />
            <Input
              label="Fecha de nacimiento (AAAA-MM-DD)"
              value={birthDate}
              onChangeText={setBirthDate}
              placeholder="1992-12-05"
            />
            <View style={{ gap: spacing.sm }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                  color: t.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                Sexo biológico
              </Text>
              <OptionRow
                selected={sex === 'male'}
                label="Hombre"
                desc=""
                icon="👨"
                onPress={() => setSex('male')}
              />
              <OptionRow
                selected={sex === 'female'}
                label="Mujer"
                desc=""
                icon="👩"
                onPress={() => setSex('female')}
              />
            </View>
          </Card>
        )}

        {/* Step 2: actividad */}
        {step === 2 && (
          <Card style={{ gap: spacing.md }}>
            {ACTIVITY_OPTIONS.map((o) => (
              <OptionRow
                key={o.value}
                selected={activity === o.value}
                label={o.label}
                desc={o.desc}
                icon={o.icon}
                onPress={() => setActivity(o.value)}
              />
            ))}
          </Card>
        )}

        {/* Step 3: objetivo */}
        {step === 3 && (
          <Card style={{ gap: spacing.md }}>
            {GOAL_OPTIONS.map((o) => (
              <OptionRow
                key={o.value}
                selected={goal === o.value}
                label={o.label}
                desc={o.desc}
                icon={o.icon}
                onPress={() => setGoal(o.value)}
              />
            ))}
            {error ? (
              <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text>
            ) : null}
          </Card>
        )}

        {/* Navigation buttons (outside the card) */}
        <View style={{ gap: spacing.md }}>
          {step === 1 && (
            <Button
              title="Siguiente →"
              onPress={() => setStep(2)}
              disabled={!step1Valid}
            />
          )}
          {step === 2 && (
            <>
              <Button title="Siguiente →" onPress={() => setStep(3)} />
              <Button title="Atrás" variant="secondary" onPress={() => setStep(1)} />
            </>
          )}
          {step === 3 && (
            <>
              <Button
                title="Calcular objetivos ✓"
                onPress={finish}
                loading={saving}
              />
              <Button title="Atrás" variant="secondary" onPress={() => setStep(2)} />
              <Text
                style={{
                  fontSize: 11,
                  color: t.textMuted,
                  textAlign: 'center',
                  lineHeight: 16,
                  paddingHorizontal: spacing.sm,
                }}
              >
                Los objetivos son estimaciones orientativas basadas en fórmulas estándar.
                VeganTrack no es un servicio médico. Consulta a un profesional de la
                salud antes de realizar cambios significativos en tu dieta.
              </Text>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
