/** Wizard de 3 pasos: datos básicos → actividad → objetivo. Calcula objetivos con Mifflin-St Jeor. */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Input } from '@/components/ui';
import { radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { calculateTargets } from '@/utils/nutrition';
import type { ActivityLevel, Goal, Sex } from '@/types';

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; desc: string }[] = [
  { value: 'sedentary', label: 'Sedentario', desc: 'Sin ejercicio' },
  { value: 'light', label: 'Ligero', desc: '1-2 días/semana' },
  { value: 'moderate', label: 'Moderado', desc: '3-4 días/semana' },
  { value: 'active', label: 'Activo', desc: '5-6 días/semana' },
  { value: 'very_active', label: 'Muy activo', desc: 'Ejercicio intenso diario' },
];

const GOAL_OPTIONS: { value: Goal; label: string; desc: string }[] = [
  { value: 'cut', label: 'Perder grasa', desc: 'Déficit de 500 kcal' },
  { value: 'maintain', label: 'Mantener', desc: 'Calorías de mantenimiento' },
  { value: 'bulk', label: 'Ganar masa', desc: 'Superávit de 300 kcal' },
];

function OptionRow({ selected, label, desc, onPress }: { selected: boolean; label: string; desc: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 2,
        borderColor: selected ? t.primary : t.cardBorder,
        backgroundColor: selected ? t.primarySoft : t.card,
        borderRadius: radii.lg,
        padding: spacing.lg,
      }}
    >
      <Text style={{ fontWeight: '700', color: t.text }}>{label}</Text>
      <Text style={{ color: t.textMuted, fontSize: 13 }}>{desc}</Text>
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
    height.trim() !== '' && weight.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && sex !== null;

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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.xl, paddingTop: insets.top + spacing.xl, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ fontSize: 24, fontWeight: '800', color: t.text }}>
        Configura tu perfil ({step}/3)
      </Text>

      {step === 1 && (
        <Card style={{ gap: spacing.lg }}>
          <Input label="Nombre" value={name} onChangeText={setName} placeholder="¿Cómo te llamas?" />
          <Input label="Altura (cm)" value={height} onChangeText={setHeight} keyboardType="numeric" placeholder="170" />
          <Input label="Peso (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" placeholder="65" />
          <Input label="Fecha de nacimiento (AAAA-MM-DD)" value={birthDate} onChangeText={setBirthDate} placeholder="1992-12-05" />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <OptionRow selected={sex === 'male'} label="Hombre" desc="" onPress={() => setSex('male')} />
            </View>
            <View style={{ flex: 1 }}>
              <OptionRow selected={sex === 'female'} label="Mujer" desc="" onPress={() => setSex('female')} />
            </View>
          </View>
          <Button title="Siguiente" onPress={() => setStep(2)} disabled={!step1Valid} />
        </Card>
      )}

      {step === 2 && (
        <Card style={{ gap: spacing.md }}>
          {ACTIVITY_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              selected={activity === o.value}
              label={o.label}
              desc={o.desc}
              onPress={() => setActivity(o.value)}
            />
          ))}
          <Button title="Siguiente" onPress={() => setStep(3)} />
          <Button title="Atrás" variant="secondary" onPress={() => setStep(1)} />
        </Card>
      )}

      {step === 3 && (
        <Card style={{ gap: spacing.md }}>
          {GOAL_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              selected={goal === o.value}
              label={o.label}
              desc={o.desc}
              onPress={() => setGoal(o.value)}
            />
          ))}
          {error ? <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text> : null}
          <Button title="Calcular objetivos y empezar" onPress={finish} loading={saving} />
          <Button title="Atrás" variant="secondary" onPress={() => setStep(2)} />
        </Card>
      )}
    </ScrollView>
  );
}
