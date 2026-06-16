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
import { Button, Card, Input, Pill, SectionHeader } from '@/components/ui';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { SUPPLEMENT_PRESETS, useSupplementStore } from '@/stores/supplementStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import { useThemeStore, type ThemePreference } from '@/stores/themeStore';
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

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentario',
  light: 'Ligero',
  moderate: 'Moderado',
  active: 'Activo',
  very_active: 'Muy activo',
};

const GOAL_LABELS: Record<Goal, string> = {
  cut: 'Perder grasa',
  maintain: 'Mantener',
  bulk: 'Ganar masa',
};

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
  const t = useTheme();
  const bg = iconBg ?? t.primarySoft;
  const ic = iconColor ?? t.primary;
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
            color: danger ? semantic.danger : t.text,
          }}
        >
          {label}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 12, color: t.textMuted }}>{subtitle}</Text>
        ) : null}
      </View>
      {badge !== undefined && badge > 0 ? (
        <View
          style={{
            backgroundColor: t.primarySoft,
            borderRadius: radii.pill,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text style={{ color: t.primary, fontSize: 11, fontWeight: '700' }}>{badge}</Text>
        </View>
      ) : null}
      {!danger ? (
        <Ionicons name={'chevron-forward' as any} size={16} color={t.textMuted} />
      ) : null}
    </Pressable>
  );
}

export function ProfileScreen() {
  const t = useTheme();
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
        Alert.alert(
          'Permiso denegado',
          'Activa las notificaciones de VeganTrack en Ajustes de Android.'
        );
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
    if (error) Alert.alert('Error', error);
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
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: insets.top + spacing.md,
        gap: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
    >
      <Text style={{ fontSize: 30, fontWeight: '700', color: t.text }}>Perfil</Text>

      {/* Avatar header card */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          {/* Avatar circle */}
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
            <Text style={{ fontSize: 26, fontWeight: '700', color: t.primary }}>{initials}</Text>
          </View>
          {/* Name + email */}
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: t.text }}>
                {displayName || 'Sin nombre'}
              </Text>
              {isPro ? <Pill text="PRO ⭐" color="#f59e0b" /> : null}
            </View>
            {email ? (
              <Text style={{ fontSize: 13, color: t.textMuted }}>{email}</Text>
            ) : null}
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Text style={{ fontSize: 13, color: t.primary, fontWeight: '700', marginTop: 2 }}>
                Editar perfil
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
            color: t.textMuted,
            textTransform: 'uppercase',
            marginBottom: spacing.sm,
          }}
        >
          Objetivos diarios
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {macroChips.map(({ label, value, leftColor }) => (
            <View
              key={label}
              style={{
                flex: 1,
                minWidth: '48%',
                backgroundColor: t.card,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: t.cardBorder,
                borderLeftWidth: 3,
                borderLeftColor: leftColor,
                padding: spacing.md,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>
                {value ?? '—'}
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                  color: t.textMuted,
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
            color: t.textMuted,
            textTransform: 'uppercase',
            marginBottom: spacing.sm,
          }}
        >
          Herramientas
        </Text>
        <Card style={{ gap: 0, padding: 0, paddingHorizontal: spacing.lg }}>
          <MenuRow
            iconName="restaurant-outline"
            label="Mis recetas"
            badge={undefined}
            onPress={() => navigation.navigate('Recipes')}
          />
          <View style={{ height: 1, backgroundColor: t.separator }} />
          <MenuRow
            iconName="fitness-outline"
            label="Suplementos"
            badge={supplementStore.supplements.length}
            onPress={() => setShowSupplements(true)}
          />
          <View style={{ height: 1, backgroundColor: t.separator }} />
          <MenuRow
            iconName="star-outline"
            label="Mis alimentos"
            badge={customFoods.customFoods.length}
            onPress={() => setShowCustomFood(true)}
          />
          <View style={{ height: 1, backgroundColor: t.separator }} />
          <MenuRow
            iconName="trending-up-outline"
            label="Tendencias de micros"
            subtitle={isPro ? undefined : 'Pro'}
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
            <Text style={{ fontWeight: '700', fontSize: 15, color: t.text }}>Recordatorio diario</Text>
          </View>
          <Switch
            value={reminderHour !== null}
            onValueChange={(v) => void toggleReminder(v)}
            trackColor={{ true: t.primary }}
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
              <Text style={{ color: t.primary, fontSize: 28, fontWeight: '800' }}>−</Text>
            </Pressable>
            <Text style={{ color: t.text, fontSize: 32, fontWeight: '800', letterSpacing: 2 }}>
              {String(reminderHour).padStart(2, '0')}:00
            </Text>
            <Pressable onPress={() => changeReminderHour(1)} hitSlop={12}>
              <Text style={{ color: t.primary, fontSize: 28, fontWeight: '800' }}>＋</Text>
            </Pressable>
          </View>
        )}
      </Card>

      <AppearanceCard />


      {/* Account section */}
      <View>
        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.8,
            color: t.textMuted,
            textTransform: 'uppercase',
            marginBottom: spacing.sm,
          }}
        >
          Cuenta
        </Text>
        <Card style={{ gap: 0, padding: 0, paddingHorizontal: spacing.lg }}>
          <MenuRow
            iconName="document-text-outline"
            label="Exportar diario CSV"
            onPress={onExport}
          />
          {!isPro && (
            <>
              <View style={{ height: 1, backgroundColor: t.separator }} />
              <Pressable
                onPress={() => setShowPro(true)}
                style={({ pressed }) => ({
                  marginVertical: spacing.sm,
                  borderRadius: radii.lg,
                  backgroundColor: t.primarySoft,
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
                    Desbloquea Pro
                  </Text>
                  <Text style={{ fontSize: 12, color: t.textMuted }}>
                    Historial y recetas ilimitados
                  </Text>
                </View>
                <Ionicons name={'arrow-forward' as any} size={18} color={semantic.success} />
              </Pressable>
              <View style={{ height: 1, backgroundColor: t.separator }} />
            </>
          )}
          {isPro && <View style={{ height: 1, backgroundColor: t.separator }} />}
          <MenuRow
            iconName="log-out-outline"
            label="Cerrar sesión"
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
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        borderWidth: 1.5,
        borderColor: selected ? t.primary : t.cardBorder,
        backgroundColor: selected ? t.primarySoft : t.card,
        borderRadius: radii.md,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
      }}
    >
      {icon ? <Text style={{ fontSize: 16 }}>{icon}</Text> : null}
      <Text style={{ flex: 1, fontWeight: '600', fontSize: 13, color: selected ? t.primary : t.text }}>
        {label}
      </Text>
      {selected ? (
        <Ionicons name={'checkmark-circle' as any} size={16} color={t.primary} />
      ) : null}
    </Pressable>
  );
}

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useAuthStore();
  const [height, setHeight] = useState(profile?.height_cm ? String(profile.height_cm) : '');
  const [weight, setWeight] = useState(profile?.weight_kg ? String(profile.weight_kg) : '');
  const [name, setName] = useState(profile?.display_name ?? '');
  const [activity, setActivity] = useState<ActivityLevel>(profile?.activity_level ?? 'moderate');
  const [goal, setGoal] = useState<Goal>(profile?.goal ?? 'maintain');
  const [saving, setSaving] = useState(false);

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
    if (error) Alert.alert('Error', error);
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
              backgroundColor: t.card,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              paddingBottom: insets.bottom + spacing.lg,
              borderWidth: 1,
              borderColor: t.cardBorder,
              maxHeight: '92%',
            }}
          >
            {/* Drag handle */}
            <View style={{ alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.separator }} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg, paddingTop: spacing.sm }}
            >
              <Text style={{ fontSize: 20, fontWeight: '800', color: t.text }}>Editar perfil</Text>

              <Input label="Nombre" value={name} onChangeText={setName} />
              <Input
                label="Altura (cm)"
                value={height}
                onChangeText={setHeight}
                keyboardType="numeric"
              />
              <Input
                label="Peso (kg)"
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
                    color: t.textMuted,
                    textTransform: 'uppercase',
                  }}
                >
                  Actividad
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => (
                    <OptionRow
                      key={a}
                      selected={activity === a}
                      label={ACTIVITY_LABELS[a]}
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
                    color: t.textMuted,
                    textTransform: 'uppercase',
                  }}
                >
                  Objetivo
                </Text>
                <View style={{ gap: spacing.sm }}>
                  {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
                    <OptionRow
                      key={g}
                      selected={goal === g}
                      label={GOAL_LABELS[g]}
                      onPress={() => setGoal(g)}
                    />
                  ))}
                </View>
              </View>

              <Button title="Guardar (recalcula objetivos)" onPress={save} loading={saving} />
              <Button title="Cancelar" variant="secondary" onPress={onClose} />
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SupplementsModal({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const { user } = useAuthStore();
  const store = useSupplementStore();
  const { isPro } = usePro();

  // Estado del editor: null = cerrado · 'new' o un Supplement = abierto.
  const [editing, setEditing] = React.useState<Supplement | 'new' | { preset: number } | null>(null);

  const tryAdd = (open: () => void) => {
    if (!isPro && store.supplements.length >= FREE_SUPPLEMENT_LIMIT) {
      Alert.alert(
        'Límite alcanzado',
        `El plan free permite ${FREE_SUPPLEMENT_LIMIT} suplementos. Hazte Pro para añadir más.`
      );
      return;
    }
    open();
  };

  // ── Editor: nuevo desde preset ────────────────────────────────────────
  if (editing && typeof editing === 'object' && 'preset' in editing) {
    const p = SUPPLEMENT_PRESETS[editing.preset];
    return (
      <SupplementEditor
        visible
        title="Añadir suplemento"
        initial={{
          name: p.name,
          emoji: p.emoji,
          nutrient_key: p.nutrient_key,
          dose_amount: p.dose_amount,
          dose_unit: p.dose_unit,
        }}
        onClose={() => setEditing(null)}
        onSave={async (draft) => {
          if (!user) return { error: 'No hay sesión' };
          return store.createSupplement(user.id, draft);
        }}
      />
    );
  }

  // ── Editor: nuevo en blanco ───────────────────────────────────────────
  if (editing === 'new') {
    return (
      <SupplementEditor
        visible
        title="Nuevo suplemento"
        initial={{ name: '', emoji: '💊', nutrient_key: null, dose_amount: 1, dose_unit: 'mg' }}
        onClose={() => setEditing(null)}
        onSave={async (draft) => {
          if (!user) return { error: 'No hay sesión' };
          return store.createSupplement(user.id, draft);
        }}
      />
    );
  }

  // ── Editor: edición de uno existente ──────────────────────────────────
  if (editing && typeof editing === 'object' && 'id' in editing) {
    const s = editing;
    return (
      <SupplementEditor
        visible
        title="Editar suplemento"
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
          <Text style={{ fontSize: 26, fontWeight: '700', color: t.text }}>
            Suplementos
          </Text>
          {!isPro ? (
            <Text style={{ color: t.textMuted, fontSize: 11 }}>
              {store.supplements.length}/{FREE_SUPPLEMENT_LIMIT} (free)
            </Text>
          ) : null}
        </View>

        {/* ── Mis suplementos ──────────────────────────────────────── */}
        {store.supplements.length > 0 ? (
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
              Mis suplementos
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
                  borderColor: t.cardBorder,
                  backgroundColor: t.card,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: t.primarySoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 20 }}>{s.emoji ?? '💊'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {s.dose_amount} {s.dose_unit}
                  </Text>
                </View>
                <Ionicons name={'pencil-outline' as any} size={16} color={t.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── Acción: crear personalizado ──────────────────────────── */}
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
            borderColor: t.primary,
            backgroundColor: t.primarySoft,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name={'add' as any} size={18} color={t.primary} />
          <Text style={{ color: t.primary, fontWeight: '700', fontSize: 14 }}>
            Crear suplemento personalizado
          </Text>
        </Pressable>

        {/* ── Presets sugeridos ────────────────────────────────────── */}
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Text
            style={{
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 0.8,
              color: t.textMuted,
              textTransform: 'uppercase',
            }}
          >
            Empezar desde un preset
          </Text>
          <Text style={{ color: t.textMuted, fontSize: 11 }}>
            Toca uno para revisar dosis y guardarlo. Puedes añadir el mismo varias veces (p. ej. una toma por la mañana y otra por la noche).
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
                  backgroundColor: t.background,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 18 }}>{p.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '600', fontSize: 14 }}>{p.name}</Text>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                  Sugerido: {p.dose_amount} {p.dose_unit}
                </Text>
              </View>
              <Ionicons name={'add-circle-outline' as any} size={20} color={t.primary} />
            </Pressable>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

function CustomFoodModal({ onClose }: { onClose: () => void }) {
  const t = useTheme();
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
      if (error) Alert.alert('Error', error);
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
      if (error) Alert.alert('Error', error);
      else { setCreating(false); resetForm(); }
    }
  };

  const confirmDelete = (f: CustomFood) => {
    Alert.alert('Eliminar', `¿Eliminar "${f.name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => void store.deleteCustomFood(f.id) },
    ]);
  };

  const showForm = editingId !== null || creating;

  return (
    <BottomSheet visible onClose={onClose} maxHeightFraction={0.88}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>Mis alimentos</Text>

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
                  borderColor: t.cardBorder,
                  backgroundColor: t.card,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>{f.name}</Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {f.calories_per_100g} kcal · P {f.protein_per_100g}g · C {f.carbs_per_100g}g · G {f.fat_per_100g}g
                  </Text>
                </View>
                <Pressable onPress={() => startEdit(f)} hitSlop={8}>
                  <Ionicons name={'pencil-outline' as any} size={18} color={t.primary} />
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
              borderColor: t.primary,
              backgroundColor: t.primarySoft,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name={'add' as any} size={18} color={t.primary} />
            <Text style={{ color: t.primary, fontWeight: '700', fontSize: 14 }}>
              Crear alimento personalizado
            </Text>
          </Pressable>
        )}

        {showForm && (
          <View style={{ gap: spacing.md }}>
            <Text style={{
              fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
              color: t.textMuted, textTransform: 'uppercase',
            }}>
              {editingId ? 'Editar alimento' : 'Crear alimento (valores por 100 g)'}
            </Text>
            <Input label="Nombre" value={name} onChangeText={setName} placeholder="Mi tempeh casero" />
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
            <Button title={editingId ? 'Guardar cambios' : 'Crear alimento'} onPress={save} />
            <Button title="Cancelar" variant="secondary" onPress={() => { setEditingId(null); setCreating(false); resetForm(); }} />
          </View>
        )}

        {store.customFoods.length === 0 && !showForm && (
          <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.md }}>
            <Text style={{ fontSize: 40 }}>⭐</Text>
            <Text style={{ color: t.textMuted, fontSize: 13, textAlign: 'center' }}>
              Aún no tienes alimentos personalizados. Crea uno con los valores nutricionales por 100 g.
            </Text>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

function AppearanceCard() {
  const t = useTheme();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const options: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
    { value: 'light', label: 'Claro', icon: 'sunny-outline' },
    { value: 'dark', label: 'Oscuro', icon: 'moon-outline' },
  ];

  return (
    <View>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.8,
          color: t.textMuted,
          textTransform: 'uppercase',
          marginBottom: spacing.sm,
        }}
      >
        Apariencia
      </Text>
      <Card style={{ gap: spacing.sm }}>
        <View
          style={{
            flexDirection: 'row',
            gap: spacing.xs,
            backgroundColor: t.background,
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
                  backgroundColor: active ? t.card : 'transparent',
                }}
              >
                <Ionicons name={opt.icon as any} size={15} color={active ? t.primary : t.textMuted} />
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: active ? t.primary : t.textMuted,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ color: t.textMuted, fontSize: 11 }}>
          "Sistema" sigue automaticamente la apariencia de tu dispositivo.
        </Text>
      </Card>
    </View>
  );
}
