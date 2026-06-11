/**
 * Perfil: datos personales y objetivos, suplementos, alimentos personalizados,
 * recordatorio diario, exportación CSV, Pro y logout.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Input, Pill, SectionHeader } from '@/components/ui';
import { radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { SUPPLEMENT_PRESETS, useSupplementStore } from '@/stores/supplementStore';
import { useCustomFoodStore } from '@/stores/customFoodStore';
import { calculateTargets } from '@/utils/nutrition';
import { exportDiaryCsv } from '@/utils/exportCsv';
import { FREE_SUPPLEMENT_LIMIT, usePro } from '@/hooks/usePro';
import {
  cancelDailyReminder,
  DEFAULT_REMINDER_HOUR,
  getReminderHour,
  scheduleDailyReminder,
} from '@/notifications/reminders';
import { WEB_BASE_URL } from '@/lib/supabase';
import type { ActivityLevel, Goal } from '@/types';
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
      else Alert.alert('Permiso denegado', 'Activa las notificaciones de VeganTrack en Ajustes de Android.');
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

  const openProCheckout = () => {
    // El checkout de Stripe vive en la web (mismas APIs Vercel que la PWA)
    void Linking.openURL(`${WEB_BASE_URL}/?upgrade=pro`);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>Perfil</Text>
        {isPro ? <Pill text="PRO ⭐" color="#f59e0b" /> : null}
      </View>

      {/* Datos y objetivos */}
      <Card style={{ gap: spacing.sm }}>
        <SectionHeader
          title={profile?.display_name ?? 'Sin nombre'}
          right={
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Text style={{ color: t.primary, fontWeight: '700' }}>Editar</Text>
            </Pressable>
          }
        />
        <Text style={{ color: t.textSecondary, fontSize: 13 }}>
          {profile?.height_cm ?? '—'} cm · {profile?.weight_kg ?? '—'} kg ·{' '}
          {profile?.activity_level ? ACTIVITY_LABELS[profile.activity_level] : '—'} ·{' '}
          {profile?.goal ? GOAL_LABELS[profile.goal] : '—'}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm }}>
          {[
            { label: 'kcal', value: profile?.calorie_target },
            { label: 'Proteína', value: profile?.protein_target_g ? `${profile.protein_target_g} g` : null },
            { label: 'Carbos', value: profile?.carbs_target_g ? `${profile.carbs_target_g} g` : null },
            { label: 'Grasas', value: profile?.fat_target_g ? `${profile.fat_target_g} g` : null },
          ].map(({ label, value }) => (
            <View key={label} style={{ alignItems: 'center' }}>
              <Text style={{ color: t.text, fontWeight: '800', fontSize: 16 }}>{value ?? '—'}</Text>
              <Text style={{ color: t.textMuted, fontSize: 11 }}>{label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Accesos */}
      <Card style={{ gap: spacing.md }}>
        <Pressable onPress={() => navigation.navigate('Recipes')} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>🍲 Mis recetas</Text>
          <Text style={{ color: t.textMuted }}>›</Text>
        </Pressable>
        <Pressable onPress={() => setShowSupplements(true)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>💊 Suplementos ({supplementStore.supplements.length})</Text>
          <Text style={{ color: t.textMuted }}>›</Text>
        </Pressable>
        <Pressable onPress={() => setShowCustomFood(true)} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: t.text, fontWeight: '600' }}>⭐ Mis alimentos ({customFoods.customFoods.length})</Text>
          <Text style={{ color: t.textMuted }}>›</Text>
        </Pressable>
      </Card>

      {/* Recordatorio */}
      <Card style={{ gap: spacing.md }}>
        <SectionHeader
          title="🔔 Recordatorio diario"
          right={<Switch value={reminderHour !== null} onValueChange={(v) => void toggleReminder(v)} trackColor={{ true: t.primary }} />}
        />
        {reminderHour !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl }}>
            <Pressable onPress={() => changeReminderHour(-1)} hitSlop={12}>
              <Text style={{ color: t.primary, fontSize: 24, fontWeight: '800' }}>−</Text>
            </Pressable>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>
              {String(reminderHour).padStart(2, '0')}:00
            </Text>
            <Pressable onPress={() => changeReminderHour(1)} hitSlop={12}>
              <Text style={{ color: t.primary, fontSize: 24, fontWeight: '800' }}>＋</Text>
            </Pressable>
          </View>
        )}
      </Card>

      {/* Export + Pro */}
      <Button title={exporting ? 'Exportando…' : '📄 Exportar diario (CSV)'} variant="secondary" onPress={onExport} loading={exporting} />
      {!isPro && <Button title="⭐ Hazte Pro — historial y recetas ilimitados" onPress={openProCheckout} />}
      <Button title="Cerrar sesión" variant="danger" onPress={() => void signOut()} />

      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
      {showSupplements && <SupplementsModal onClose={() => setShowSupplements(false)} />}
      {showCustomFood && <CustomFoodModal onClose={() => setShowCustomFood(false)} />}
    </ScrollView>
  );
}

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const t = useTheme();
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
      <ScrollView
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={{ gap: spacing.md }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>Editar perfil</Text>
          <Input label="Nombre" value={name} onChangeText={setName} />
          <Input label="Altura (cm)" value={height} onChangeText={setHeight} keyboardType="numeric" />
          <Input label="Peso (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" />
          <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Actividad</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => (
              <Pressable
                key={a}
                onPress={() => setActivity(a)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: radii.pill,
                  borderWidth: 2,
                  borderColor: activity === a ? t.primary : t.cardBorder,
                }}
              >
                <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>{ACTIVITY_LABELS[a]}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Objetivo</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
              <Pressable
                key={g}
                onPress={() => setGoal(g)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 8,
                  borderRadius: radii.pill,
                  borderWidth: 2,
                  borderColor: goal === g ? t.primary : t.cardBorder,
                }}
              >
                <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>{GOAL_LABELS[g]}</Text>
              </Pressable>
            ))}
          </View>
          <Button title="Guardar (recalcula objetivos)" onPress={save} loading={saving} />
          <Button title="Cancelar" variant="secondary" onPress={onClose} />
        </Card>
      </ScrollView>
    </Modal>
  );
}

function SupplementsModal({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const { user } = useAuthStore();
  const store = useSupplementStore();
  const { isPro } = usePro();

  const addPreset = async (presetIndex: number) => {
    if (!user) return;
    if (!isPro && store.supplements.length >= FREE_SUPPLEMENT_LIMIT) {
      Alert.alert('Límite alcanzado', `El plan free permite ${FREE_SUPPLEMENT_LIMIT} suplementos.`);
      return;
    }
    const p = SUPPLEMENT_PRESETS[presetIndex];
    const { error } = await store.createSupplement(user.id, {
      name: p.name,
      nutrient_key: p.nutrient_key,
      emoji: p.emoji,
      dose_amount: p.dose_amount,
      dose_unit: p.dose_unit,
    });
    if (error) Alert.alert('Error', error);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Card style={{ gap: spacing.md, maxHeight: '85%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <SectionHeader
            title="💊 Suplementos"
            right={
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={{ color: t.primary, fontWeight: '700' }}>Cerrar</Text>
              </Pressable>
            }
          />
          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: spacing.sm }}>
            {store.supplements.map((s) => (
              <Pressable
                key={s.id}
                onLongPress={() =>
                  Alert.alert('Eliminar', `¿Eliminar "${s.name}"?`, [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Eliminar', style: 'destructive', onPress: () => void store.deleteSupplement(s.id) },
                  ])
                }
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
              >
                <Text style={{ color: t.text, fontWeight: '600' }}>
                  {s.emoji ? `${s.emoji} ` : ''}{s.name}
                </Text>
                <Text style={{ color: t.textMuted }}>{s.dose_amount} {s.dose_unit}</Text>
              </Pressable>
            ))}
            <Text style={{ color: t.textSecondary, fontWeight: '700', marginTop: spacing.sm }}>Añadir preset</Text>
            {SUPPLEMENT_PRESETS.map((p, i) => (
              <Pressable key={p.name} onPress={() => void addPreset(i)} style={{ paddingVertical: 6 }}>
                <Text style={{ color: t.primary, fontWeight: '600' }}>
                  ＋ {p.emoji} {p.name} ({p.dose_amount} {p.dose_unit})
                </Text>
              </Pressable>
            ))}
            <Text style={{ color: t.textMuted, fontSize: 11 }}>Mantén pulsado un suplemento para eliminarlo.</Text>
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

function CustomFoodModal({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const { user } = useAuthStore();
  const store = useCustomFoodStore();
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');

  const num = (s: string) => parseFloat(s.replace(',', '.')) || 0;

  const create = async () => {
    if (!user || !name.trim()) return;
    const { error } = await store.createCustomFood(user.id, {
      name: name.trim(),
      brand: null,
      calories_per_100g: num(kcal),
      protein_per_100g: num(protein),
      carbs_per_100g: num(carbs),
      fat_per_100g: num(fat),
      fiber_per_100g: num(fiber),
      sugar_per_100g: 0,
      saturated_fat_per_100g: 0,
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
    else {
      setName(''); setKcal(''); setProtein(''); setCarbs(''); setFat(''); setFiber('');
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <Card style={{ gap: spacing.md, maxHeight: '85%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
          <SectionHeader
            title="⭐ Mis alimentos"
            right={
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={{ color: t.primary, fontWeight: '700' }}>Cerrar</Text>
              </Pressable>
            }
          />
          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
            {store.customFoods.map((f) => (
              <Pressable
                key={f.id}
                onLongPress={() =>
                  Alert.alert('Eliminar', `¿Eliminar "${f.name}"?`, [
                    { text: 'Cancelar', style: 'cancel' },
                    { text: 'Eliminar', style: 'destructive', onPress: () => void store.deleteCustomFood(f.id) },
                  ])
                }
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
              >
                <Text style={{ color: t.text, fontWeight: '600' }}>{f.name}</Text>
                <Text style={{ color: t.textMuted }}>{f.calories_per_100g} kcal/100g</Text>
              </Pressable>
            ))}
            <Text style={{ color: t.textSecondary, fontWeight: '700', marginTop: spacing.sm }}>Crear (valores por 100 g)</Text>
            <Input label="Nombre" value={name} onChangeText={setName} placeholder="Mi tempeh casero" />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Input label="kcal" value={kcal} onChangeText={setKcal} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><Input label="Prot." value={protein} onChangeText={setProtein} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><Input label="Carb." value={carbs} onChangeText={setCarbs} keyboardType="numeric" /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Input label="Grasa" value={fat} onChangeText={setFat} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><Input label="Fibra" value={fiber} onChangeText={setFiber} keyboardType="numeric" /></View>
            </View>
            <Button title="Crear alimento" onPress={create} />
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}
