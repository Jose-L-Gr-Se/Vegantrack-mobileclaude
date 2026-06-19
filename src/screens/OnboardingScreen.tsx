/** Wizard de 3 pasos: datos básicos → actividad → objetivo. Calcula objetivos con Mifflin-St Jeor. */
import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { fonts, radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { calculateTargets } from '@/utils/nutrition';
import type { ActivityLevel, Goal, Sex } from '@/types';

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
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        borderWidth: 1.5,
        borderColor: selected ? theme.primary : theme.cardBorder,
        backgroundColor: selected ? theme.primarySoft : theme.card,
        borderRadius: radii.lg,
        padding: spacing.lg,
      }}
    >
      {icon ? <Text style={{ fontSize: 20 }}>{icon}</Text> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: selected ? theme.primary : theme.text, fontSize: 15 }}>
          {label}
        </Text>
        {desc ? (
          <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 2 }}>{desc}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name={'checkmark-circle' as any} size={20} color={theme.primary} />
      ) : null}
    </Pressable>
  );
}

export function OnboardingScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
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

  const activityOptions: { value: ActivityLevel; icon: string }[] = [
    { value: 'sedentary', icon: '🪑' },
    { value: 'light', icon: '🚶' },
    { value: 'moderate', icon: '🚴' },
    { value: 'active', icon: '🏋️' },
    { value: 'very_active', icon: '⚡' },
  ];

  const goalOptions: { value: Goal; icon: string }[] = [
    { value: 'cut', icon: '🔥' },
    { value: 'maintain', icon: '⚖️' },
    { value: 'bulk', icon: '💪' },
  ];

  const stepMeta = [
    { title: t('onboarding.step1Title'), subtitle: t('onboarding.step1Sub') },
    { title: t('onboarding.step2Title'), subtitle: t('onboarding.step2Sub') },
    { title: t('onboarding.step3Title'), subtitle: t('onboarding.step3Sub') },
  ];

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
      setError(t('onboarding.calcError'));
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

  const meta = stepMeta[step - 1];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
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
          <Text style={{ fontFamily: fonts.display, fontSize: 19, fontWeight: '400', letterSpacing: -0.3, color: theme.text }}>
            Vegetrack
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
                  backgroundColor: theme.primary,
                }}
              />
            ) : (
              <View
                key={s}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: radii.pill,
                  backgroundColor: theme.separator,
                }}
              />
            )
          )}
        </View>

        {/* Step title + subtitle */}
        <View style={{ gap: spacing.xs }}>
          <Text style={{ fontSize: 30, fontWeight: '700', color: theme.text }}>{meta.title}</Text>
          <Text style={{ fontSize: 14, color: theme.textMuted, lineHeight: 20 }}>{meta.subtitle}</Text>
        </View>

        {/* Step 1: datos básicos */}
        {step === 1 && (
          <Card style={{ gap: spacing.lg }}>
            <Input
              label={t('onboarding.name')}
              value={name}
              onChangeText={setName}
              placeholder={t('onboarding.namePlaceholder')}
            />
            <Input
              label={t('onboarding.height')}
              value={height}
              onChangeText={setHeight}
              keyboardType="numeric"
              placeholder="170"
            />
            <Input
              label={t('onboarding.weight')}
              value={weight}
              onChangeText={setWeight}
              keyboardType="numeric"
              placeholder="65"
            />
            <Input
              label={t('onboarding.birthDate')}
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
                  color: theme.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                {t('onboarding.sex')}
              </Text>
              <OptionRow
                selected={sex === 'male'}
                label={t('onboarding.male')}
                desc=""
                icon="👨"
                onPress={() => setSex('male')}
              />
              <OptionRow
                selected={sex === 'female'}
                label={t('onboarding.female')}
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
            {activityOptions.map((o) => (
              <OptionRow
                key={o.value}
                selected={activity === o.value}
                label={t(`onboarding.activity.${o.value}` as any)}
                desc={t(`onboarding.activity.${o.value}Desc` as any)}
                icon={o.icon}
                onPress={() => setActivity(o.value)}
              />
            ))}
          </Card>
        )}

        {/* Step 3: objetivo */}
        {step === 3 && (
          <Card style={{ gap: spacing.md }}>
            {goalOptions.map((o) => (
              <OptionRow
                key={o.value}
                selected={goal === o.value}
                label={t(`onboarding.goal.${o.value}` as any)}
                desc={t(`onboarding.goal.${o.value}Desc` as any)}
                icon={o.icon}
                onPress={() => setGoal(o.value)}
              />
            ))}
            {error ? (
              <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text>
            ) : null}
          </Card>
        )}

        {/* Navigation buttons */}
        <View style={{ gap: spacing.md }}>
          {step === 1 && (
            <Button
              title={t('onboarding.next')}
              onPress={() => setStep(2)}
              disabled={!step1Valid}
            />
          )}
          {step === 2 && (
            <>
              <Button title={t('onboarding.next')} onPress={() => setStep(3)} />
              <Button title={t('onboarding.back')} variant="secondary" onPress={() => setStep(1)} />
            </>
          )}
          {step === 3 && (
            <>
              <Button
                title={t('onboarding.finish')}
                onPress={finish}
                loading={saving}
              />
              <Button title={t('onboarding.back')} variant="secondary" onPress={() => setStep(2)} />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
