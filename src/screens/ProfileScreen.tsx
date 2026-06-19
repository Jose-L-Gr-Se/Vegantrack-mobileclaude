/**
 * Perfil: datos personales y objetivos, suplementos, alimentos personalizados,
 * recordatorio diario, exportación CSV, Pro y logout.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, Pill, SectionHeader } from '@/components/ui';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { SUPPLEMENT_PRESETS, useSupplementStore } from '@/stores/supplementStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import { useThemeStore, type ThemePreference } from '@/stores/themeStore';
import { useLanguageStore } from '@/stores/languageStore';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { calculateTargets } from '@/utils/nutrition';
import { exportDiaryCsv } from '@/utils/exportCsv';
import { FREE_SUPPLEMENT_LIMIT, usePro } from '@/hooks/usePro';
import {
  cancelDailyReminder,
  DEFAULT_REMINDER_HOUR,
  getReminderHour,
  scheduleDailyReminder,
} from '@/notifications/reminders';
import { ProModal } from '@/components/ProModal';
import { BottomSheet } from '@/components/BottomSheet';
import { SupplementEditor } from '@/components/SupplementEditor';
import type { ActivityLevel, CustomFood, Goal, Supplement } from '@/types';
import type { RootStackParamList } from '@/navigation/types';

/** A reusable row inside a Card — 52px tall with icon, label+subtitle, and optional right element. */
function MenuRow({
  iconName,
  label,
  subtitle,
  badge,
  onPress,
  iconBg,
  iconColor,
  danger,
}: {
  iconName: string;
  label: string;
  subtitle?: string;
  badge?: number;
  onPress: () => void;
  iconBg?: string;
  iconColor?: string;
  danger?: boolean;
}) {
  const theme = useTheme();
  const bg = iconBg ?? theme.primarySoft;
  const ic = iconColor ?? theme.primary;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={iconName as any} size={17} color={ic} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontWeight: '700',
            fontSize: 15,
            color: danger ? semantic.danger : theme.text,
          }}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 12, color: theme.textMuted }}>{subtitle}</Text>
        ) : null}
      </View>
      {badge !== undefined && badge > 0 ? (
        <View
          style={{
            backgroundColor: theme.primarySoft,
            borderRadius: radii.pill,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color: theme.primary, fontSize: 11, fontWeight: '700' }}>{badge}</Text>
        </View>
      ) : null}
      {!danger ? (
        <Ionicons name={'chevron-forward' as any} size={16} color={theme.textMuted} />
      ) : null}
    </Pressable>
  );
}

export function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, profile, updateProfile, signOut } = useAuthStore();
  const supplementStore = useSupplementStore();
  const customFoods = useCustomFoodStore();
  const { isPro } = usePro();

  const [editing, setEditing] = useState(false);
  const [showSupplements, setShowSupplements] = useState(false);
  const [showCustomFood, setShowCustomFood] = useState(false);
  const [reminderHour, setReminderHour] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showPro, setShowPro] = useState(false);

  useEffect(() => {
    void getReminderHour().then(setReminderHour);
    if (user) {
      void supplementStore.fetchSupplements(user.id);
      void customFoods.fetchCustomFoods(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const toggleReminder = async (enabled: boolean) => {
    if (enabled) {
      const ok = await scheduleDailyReminder(DEFAULT_REMINDER_HOUR);
      if (ok) setReminderHour(DEFAULT_REMINDER_HOUR);
      else
        Alert.alert(t('profile.permissionDenied'), t('profile.permissionMsg'));
    } else {
      await cancelDailyReminder();
      setReminderHour(null);
    }
  };

  const changeReminderHour = (delta: number) => {
    if (reminderHour === null) return;
    const next = (reminderHour + delta + 24) % 24;
    setReminderHour(next);
    void scheduleDailyReminder(next);
  };

  const onExport = async () => {
    if (!user) return;
    setExporting(true);
    const { error } = await exportDiaryCsv(user.id, isPro);
    setExporting(false);
    if (error) Alert.alert(t('common.error'), error);
  };

  const openMicroTrends = () => {
    if (isPro) navigation.navigate('MicroTrends');
    else setShowPro(true);
  };

  // Avatar initials
  const displayName = profile?.display_name ?? '';
  const email = user?.email ?? '';
  const initials = displayName
    ? displayName[0].toUpperCase()
    : email
    ? email[0].toUpperCase()
    : '?';

  const macroChips = [
    { label: 'KCAL', value: profile?.calorie_target, leftColor: semantic.success },
    { label: 'PROT', value: profile?.protein_target_g ? `${profile.protein_target_g}g` : null, leftColor: semantic.protein },
    { label: 'CARBS', value: profile?.carbs_target_g ? `${profile.carbs_target_g}g` : null, leftColor: semantic.carbs },
    { label: 'GRASAS', value: profile?.fat_target_g ? `${profile.fat_target_g}g` : null, leftColor: '#a855f7' },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: insets.top + spacing.md,
        gap: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
    >
      <Text style={{ fontSize: 30, fontWeight: '700', color: theme.text }}>{t('profile.title')}</Text>

      {/* Avatar header card */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {/* Avatar circle */}
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
            <Text style={{ fontSize: 26, fontWeight: '700', color: theme.primary }}>{initials}</Text>
          </View>
          {/* Name + email */}
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
                {displayName || t('profile.noName')}
              </Text>
              {isPro ? <Pill text="PRO ⭐" color="#f59e0b" /> : null}
            </View>
            {email ? (
              <Text style={{ fontSize: 13, color: theme.textMuted }}>{email}</Text>
            ) : null}
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Text style={{ fontSize: 13, color: theme.primary, fontWeight: '700', marginTop: 2 }}>
                {t('profile.editProfile')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Card>

      {/* Targets macro chips */}
      <View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.8,
            color: theme.textMuted,
            textTransform: 'uppercase',
            marginBottom: spacing.sm,
          }}
        >
          {t('profile.dailyTargets')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {macroChips.map(({ label, value, leftColor }) => (
            <View
              key={label}
              style={{
                flex: 1,
                minWidth: '48%',
                backgroundColor: theme.card,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: theme.cardBorder,
                borderLeftWidth: 3,
                borderLeftColor: leftColor,
                padding: spacing.md,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '800', color: theme.text }}>
                {value ?? '—'}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                  color: theme.textMuted,
                  textTransform: 'uppercase',
                  marginTop: 2,
                }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Tools section */}
      <View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.8,
            color: theme.textMuted,
            textTransform: 'uppercase',
            marginBottom: spacing.sm,
          }}
        >
          {t('profile.tools')}
        </Text>
        <Card style={{ gap: 0, padding: 0, paddingHorizontal: spacing.lg }}>
          <MenuRow
            iconName="restaurant-outline"
            label={t('profile.myRecipes')}
            badge={undefined}
            onPress={() => navigation.navigate('Recipes')}
          />
          <View style={{ height: 1, backgroundColor: theme.separator }} />
          <MenuRow
            iconName="fitness-outline"
            label={t('profile.supplementsModal.title')}
            badge={supplementStore.supplements.length}
            onPress={() => setShowSupplements(true)}
          />
          <View style={{ height: 1, backgroundColor: theme.separator }} />
          <MenuRow
            iconName="star-outline"
            label={t('profile.myFoods')}
            badge={customFoods.customFoods.length}
            onPress={() => setShowCustomFood(true)}
          />
          <View style={{ height: 1, backgroundColor: theme.separator }} />
          <MenuRow
            iconName="trending-up-outline"
            label={t('profile.microTrends')}
            subtitle={isPro ? undefined : t('profile.microTrendsSub')}
            onPress={openMicroTrends}
          />
        </Card>
      </View>

      {/* Recordatorio */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: '#fef3c7',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={'notifications-outline' as any} size={17} color="#f59e0b" />
            </View>
            <Text style={{ fontWeight: '700', fontSize: 15, color: theme.text }}>{t('profile.reminder')}</Text>
          </View>
          <Switch
            value={reminderHour !== null}
            onValueChange={(v) => void toggleReminder(v)}
            trackColor={{ true: theme.primary }}
          />
        </View>
        {reminderHour !== null && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.xl,
            }}
          >
            <Pressable onPress={() => changeReminderHour(-1)} hitSlop={12}>
              <Text style={{ color: theme.primary, fontSize: 28, fontWeight: '800' }}>−</Text>
            </Pressable>
            <Text style={{ color: theme.text, fontSize: 32, fontWeight: '800', letterSpacing: 2 }}>
              {String(reminderHour).padStart(2, '0')}:00
            </Text>
            <Pressable onPress={() => changeReminderHour(1)} hitSlop={12}>
              <Text style={{ color: theme.primary, fontSize: 28, fontWeight: '800' }}>＋</Text>
            </Pressable>
          </View>
        )}
      </Card>

      <AppearanceCard />
      <LanguageCard />

      {/* Account section */}
      <View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.8,
            color: theme.textMuted,
            textTransform: 'uppercase',
            marginBottom: spacing.sm,
          }}
        >
          {t('profile.account')}
        </Text>
        <Card style={{ gap: 0, padding: 0, paddingHorizontal: spacing.lg }}>
          <MenuRow
            iconName="document-text-outline"
            label={t('profile.exportCsv')}
            onPress={onExport}
          />
          {!isPro && (
            <>
              <View style={{ height: 1, backgroundColor: theme.separator }} />
              <Pressable
                onPress={() => setShowPro(true)}
                style={({ pressed }) => ({
                  marginVertical: spacing.sm,
                  borderRadius: radii.lg,
                  backgroundColor: theme.primarySoft,
                  borderWidth: 1,
                  borderColor: semantic.success,
                  padding: spacing.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontSize: 20 }}>👑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 14, color: semantic.success }}>
                    {t('profile.unlockPro')}
                  </Text>
                  <Text style={{ fontSize: 12, color: theme.textMuted }}>
                    {t('profile.unlockProSub')}
                  </Text>
                </View>
                <Ionicons name={'arrow-forward' as any} size={18} color={semantic.success} />
              </Pressable>
              <View style={{ height: 1, backgroundColor: theme.separator }} />
            </>
          )}
          {isPro && <View style={{ height: 1, backgroundColor: theme.separator }} />}
          <MenuRow
            iconName="log-out-outline"
            label={t('profile.logout')}
            onPress={() => void signOut()}
            iconBg="#fee2e2"
            iconColor={semantic.danger}
            danger
          />
        </Card>
      </View>

      {showPro && <ProModal isPro={isPro} onClose={() => setShowPro(false)} />}
      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
      {showSupplements && <SupplementsModal onClose={() => setShowSupplements(false)} />}
      {showCustomFood && <CustomFoodModal onClose={() => setShowCustomFood(false)} />}
    </ScrollView>
  );
}

function OptionRow({
  selected,
  label,
  icon,
  onPress,
}: {
  selected: boolean;
  label: string;
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
        gap: spacing.sm,
        borderWidth: 1.5,
        borderColor: selected ? theme.primary : theme.cardBorder,
        backgroundColor: selected ? theme.primarySoft : theme.card,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      {icon ? <Text style={{ fontSize: 16 }}>{icon}</Text> : null}
      <Text style={{ flex: 1, fontWeight: '600', fontSize: 13, color: selected ? theme.primary : theme.text }}>
        {label}
      </Text>
      {selected ? (
        <Ionicons name={'checkmark-circle' as any} size={16} color={theme.primary} />
      ) : null}
    </Pressable>
  );
}

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuthStore();
  const [height, setHeight] = useState(profile?.height_cm ? String(profile.height_cm) : '');
  const [weight, setWeight] = useState(profile?.weight_kg ? String(profile.weight_kg) : '');
  const [name, setName] = useState(profile?.display_name ?? '');
  const [activity, setActivity] = useState<ActivityLevel>(profile?.activity_level ?? 'moderate');
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? 'maintain');
  const [saving, setSaving] = useState(false);

  const activityKeys: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
  const goalKeys: Goal[] = ['cut', 'maintain', 'bulk'];

  const save = async () => {
    setSaving(true);
    const base = {
      ...profile,
      display_name: name.trim() || null,
      height_cm: parseFloat(height.replace(',', '.')) || profile?.height_cm || null,
      weight_kg: parseFloat(weight.replace(',', '.')) || profile?.weight_kg || null,
      activity_level: activity,
      goal,
    };
    const targets = calculateTargets(base);
    const { error } = await updateProfile({
      display_name: base.display_name,
      height_cm: base.height_cm,
      weight_kg: base.weight_kg,
      activity_level: activity,
      goal,
      ...(targets
        ? {
            calorie_target: targets.calories,
            protein_target_g: targets.protein_g,
            carbs_target_g: targets.carbs_g,
            fat_target_g: targets.fat_g,
          }
        : {}),
    });
    setSaving(false);
    if (error) Alert.alert(t('common.error'), error);
    else onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable onPress={() => undefined}>
          <View
            style={{
              backgroundColor: theme.card,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingBottom: insets.bottom + spacing.lg,
              borderWidth: 1,
              borderColor: theme.cardBorder,
              maxHeight: '92%',
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.separator }} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg, paddingTop: spacing.sm }}
            >
              <Text style={{ fontSize: 20, fontWeight: '800', color: theme.text }}>{t('profile.editModal.title')}</Text>

              <Input label={t('profile.editModal.name')} value={name} onChangeText={setName} />
              <Input
                label={t('profile.editModal.height')}
                value={height}
                onChangeText={setHeight}
                keyboardType="numeric"
              />
              <Input
                label={t('profile.editModal.weight')}
                value={weight}
                onChangeText={setWeight}
                keyboardType="numeric"
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
                  {t('profile.editModal.activityLabel')}
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {activityKeys.map((a) => (
                    <OptionRow
                      key={a}
                      selected={activity === a}
                      label={t(`profile.activity.${a}` as any)}
                      onPress={() => setActivity(a)}
                    />
                  ))}
                </View>
              </View>

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
                  {t('profile.editModal.goalLabel')}
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {goalKeys.map((g) => (
                    <OptionRow
                      key={g}
                      selected={goal === g}
                      label={t(`profile.goal.${g}` as any)}
                      onPress={() => setGoal(g)}
                    />
                  ))}
                </View>
              </View>

              <Button title={t('profile.editModal.save')} onPress={save} loading={saving} />
              <Button title={t('common.cancel')} variant="secondary" onPress={onClose} />
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SupplementsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuthStore();
  const store = useSupplementStore();
  const { isPro } = usePro();

  const [editing, setEditing] = React.useState<Supplement | 'new' | { preset: number } | null>(null);

  const tryAdd = (open: () => void) => {
    if (!isPro && store.supplements.length >= FREE_SUPPLEMENT_LIMIT) {
      Alert.alert(
        t('diary.limitTitle'),
        t('diary.limitMsg', { count: FREE_SUPPLEMENT_LIMIT })
      );
      return;
    }
    open();
  };

  if (editing && typeof editing === 'object' && 'preset' in editing) {
    const p = SUPPLEMENT_PRESETS[editing.preset];
    return (
      <SupplementEditor
        visible
        title={t('diary.addSupplement')}
        initial={{
          name: p.name,
          emoji: p.emoji,
          nutrient_key: p.nutrient_key,
          dose_amount: p.dose_amount,
          dose_unit: p.dose_unit,
        }}
        onClose={() => setEditing(null)}
        onSave={async (draft) => {
          if (!user) return { error: t('diary.noSession') };
          return store.createSupplement(user.id, draft);
        }}
      />
    );
  }

  if (editing === 'new') {
    return (
      <SupplementEditor
        visible
        title={t('diary.newSupplement')}
        initial={{ name: '', emoji: '💊', nutrient_key: null, dose_amount: 1, dose_unit: 'mg' }}
        onClose={() => setEditing(null)}
        onSave={async (draft) => {
          if (!user) return { error: t('diary.noSession') };
          return store.createSupplement(user.id, draft);
        }}
      />
    );
  }

  if (editing && typeof editing === 'object' && 'id' in editing) {
    const s = editing;
    return (
      <SupplementEditor
        visible
        title={t('diary.editSupplement')}
        initial={{
          name: s.name,
          emoji: s.emoji,
          nutrient_key: s.nutrient_key,
          dose_amount: s.dose_amount,
          dose_unit: s.dose_unit,
        }}
        onClose={() => setEditing(null)}
        onSave={async (draft) => store.updateSupplement(s.id, draft)}
        onDelete={() => void store.deleteSupplement(s.id)}
      />
    );
  }

  return (
    <BottomSheet visible onClose={onClose} maxHeightFraction={0.88}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 26, fontWeight: '700', color: theme.text }}>
            {t('profile.supplementsModal.title')}
          </Text>
          {!isPro ? (
            <Text style={{ color: theme.textMuted, fontSize: 11 }}>
              {store.supplements.length}/{FREE_SUPPLEMENT_LIMIT} (free)
            </Text>
          ) : null}
        </View>

        {store.supplements.length > 0 ? (
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
              {t('profile.supplementsModal.mine')}
            </Text>
            {store.supplements.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setEditing(s)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: radii.lg,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.card,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: theme.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 20 }}>{s.emoji ?? '💊'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {s.dose_amount} {s.dose_unit}
                  </Text>
                </View>
                <Ionicons name={'pencil-outline' as any} size={16} color={theme.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => tryAdd(() => setEditing('new'))}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.sm,
            paddingVertical: spacing.md,
            borderRadius: radii.lg,
            borderWidth: 1.5,
            borderColor: theme.primary,
            backgroundColor: theme.primarySoft,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name={'add' as any} size={18} color={theme.primary} />
          <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 14 }}>
            {t('profile.supplementsModal.createCustom')}
          </Text>
        </Pressable>

        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              color: theme.textMuted,
              textTransform: 'uppercase',
            }}
          >
            {t('profile.supplementsModal.startFromPreset')}
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
            {t('profile.supplementsModal.presetHint')}
          </Text>
          {SUPPLEMENT_PRESETS.map((p, i) => (
            <Pressable
              key={p.name}
              onPress={() => tryAdd(() => setEditing({ preset: i }))}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radii.md,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.background,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>{p.name}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                  {t('diary.supplementSuggested', { amount: p.dose_amount, unit: p.dose_unit })}
                </Text>
              </View>
              <Ionicons name={'add-circle-outline' as any} size={20} color={theme.primary} />
            </Pressable>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

function CustomFoodModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { user } = useAuthStore();
  const store = useCustomFoodStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');
  const [sugar, setSugar] = useState('');
  const [satFat, setSatFat] = useState('');

  const num = (s: string) => parseFloat(s.replace(',', '.')) || 0;

  const resetForm = () => {
    setName(''); setKcal(''); setProtein(''); setCarbs('');
    setFat(''); setFiber(''); setSugar(''); setSatFat('');
  };

  const startEdit = (f: CustomFood) => {
    setEditingId(f.id);
    setCreating(false);
    setName(f.name);
    setKcal(f.calories_per_100g ? String(f.calories_per_100g) : '');
    setProtein(f.protein_per_100g ? String(f.protein_per_100g) : '');
    setCarbs(f.carbs_per_100g ? String(f.carbs_per_100g) : '');
    setFat(f.fat_per_100g ? String(f.fat_per_100g) : '');
    setFiber(f.fiber_per_100g ? String(f.fiber_per_100g) : '');
    setSugar(f.sugar_per_100g ? String(f.sugar_per_100g) : '');
    setSatFat(f.saturated_fat_per_100g ? String(f.saturated_fat_per_100g) : '');
  };

  const startCreate = () => {
    setEditingId(null);
    setCreating(true);
    resetForm();
  };

  const save = async () => {
    if (!user || !name.trim()) return;
    const foodData = {
      name: name.trim(),
      calories_per_100g: num(kcal),
      protein_per_100g: num(protein),
      carbs_per_100g: num(carbs),
      fat_per_100g: num(fat),
      fiber_per_100g: num(fiber),
      sugar_per_100g: num(sugar),
      saturated_fat_per_100g: num(satFat),
    };

    if (editingId) {
      const { error } = await store.updateCustomFood(editingId, foodData);
      if (error) Alert.alert(t('common.error'), error);
      else { setEditingId(null); resetForm(); }
    } else {
      const { error } = await store.createCustomFood(user.id, {
        ...foodData,
        brand: null,
        sodium_mg_per_100g: 0,
        vitamin_b12_mcg_per_100g: null,
        iron_mg_per_100g: null,
        zinc_mg_per_100g: null,
        calcium_mg_per_100g: null,
        vitamin_d_mcg_per_100g: null,
        omega3_g_per_100g: null,
        is_vegan: true,
        image_url: null,
      });
      if (error) Alert.alert(t('common.error'), error);
      else { setCreating(false); resetForm(); }
    }
  };

  const confirmDelete = (f: CustomFood) => {
    Alert.alert(t('common.delete'), t('diary.deleteConfirm', { name: f.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void store.deleteCustomFood(f.id) },
    ]);
  };

  const showForm = editingId !== null || creating;

  return (
    <BottomSheet visible onClose={onClose} maxHeightFraction={0.88}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: theme.text }}>{t('profile.customFood.title')}</Text>

        {store.customFoods.length > 0 && !showForm && (
          <View style={{ gap: spacing.sm }}>
            {store.customFoods.map((f) => (
              <View
                key={f.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: radii.lg,
                  borderWidth: 1,
                  borderColor: theme.cardBorder,
                  backgroundColor: theme.card,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>{f.name}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {f.calories_per_100g} kcal · P {f.protein_per_100g}g · C {f.carbs_per_100g}g · G {f.fat_per_100g}g
                  </Text>
                </View>
                <Pressable onPress={() => startEdit(f)} hitSlop={8}>
                  <Ionicons name={'pencil-outline' as any} size={18} color={theme.primary} />
                </Pressable>
                <Pressable onPress={() => confirmDelete(f)} hitSlop={8}>
                  <Ionicons name={'trash-outline' as any} size={18} color={semantic.danger} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {!showForm && (
          <Pressable
            onPress={startCreate}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              paddingVertical: spacing.md,
              borderRadius: radii.lg,
              borderWidth: 1.5,
              borderColor: theme.primary,
              backgroundColor: theme.primarySoft,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name={'add' as any} size={18} color={theme.primary} />
            <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 14 }}>
              {t('profile.customFood.create')}
            </Text>
          </Pressable>
        )}

        {showForm && (
          <View style={{ gap: spacing.md }}>
            <Text style={{
              fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
              color: theme.textMuted, textTransform: 'uppercase',
            }}>
              {editingId ? t('profile.customFood.editTitle') : t('profile.customFood.createTitle')}
            </Text>
            <Input label={t('profile.editModal.name')} value={name} onChangeText={setName} placeholder="Mi tempeh casero" />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input label="kcal" value={kcal} onChangeText={setKcal} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Prot." value={protein} onChangeText={setProtein} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Carb." value={carbs} onChangeText={setCarbs} keyboardType="numeric" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input label="Grasa" value={fat} onChangeText={setFat} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="Fibra" value={fiber} onChangeText={setFiber} keyboardType="numeric" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Input label="Azúcar" value={sugar} onChangeText={setSugar} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="G. sat." value={satFat} onChangeText={setSatFat} keyboardType="numeric" />
              </View>
            </View>
            <Button title={editingId ? t('profile.customFood.save') : t('profile.customFood.saveCreate')} onPress={save} />
            <Button title={t('common.cancel')} variant="secondary" onPress={() => { setEditingId(null); setCreating(false); resetForm(); }} />
          </View>
        )}

        {store.customFoods.length === 0 && !showForm && (
          <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.md }}>
            <Text style={{ fontSize: 40 }}>⭐</Text>
            <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: 'center' }}>
              {t('profile.customFood.empty')}
            </Text>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

function AppearanceCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const options: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: t('profile.themeSystem'), icon: 'phone-portrait-outline' },
    { value: 'light', label: t('profile.themeLight'), icon: 'sunny-outline' },
    { value: 'dark', label: t('profile.themeDark'), icon: 'moon-outline' },
  ];

  return (
    <View>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.8,
          color: theme.textMuted,
          textTransform: 'uppercase',
          marginBottom: spacing.sm,
        }}
      >
        {t('profile.appearance')}
      </Text>
      <Card style={{ gap: spacing.sm }}>
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.xs,
            backgroundColor: theme.background,
            borderRadius: radii.pill,
            padding: 4,
          }}
        >
          {options.map((opt) => {
            const active = preference === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => void setPreference(opt.value)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 9,
                  borderRadius: radii.pill,
                  backgroundColor: active ? theme.card : 'transparent',
                }}
              >
                <Ionicons name={opt.icon as any} size={15} color={active ? theme.primary : theme.textMuted} />
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: active ? theme.primary : theme.textMuted,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ color: theme.textMuted, fontSize: 11 }}>
          {t('profile.appearanceHint')}
        </Text>
      </Card>
    </View>
  );
}

function LanguageCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);

  return (
    <View>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.8,
          color: theme.textMuted,
          textTransform: 'uppercase',
          marginBottom: spacing.sm,
        }}
      >
        {t('profile.language')}
      </Text>
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {(SUPPORTED_LANGUAGES as readonly SupportedLanguage[]).map((lang) => {
            const active = language === lang;
            return (
              <Pressable
                key={lang}
                onPress={() => void setLanguage(lang)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radii.pill,
                  backgroundColor: active ? theme.primary : theme.background,
                  borderWidth: 1,
                  borderColor: active ? theme.primary : theme.cardBorder,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: active ? '#fff' : theme.text }}>
                  {t(`lang.${lang}` as any)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
    </View>
  );
}
