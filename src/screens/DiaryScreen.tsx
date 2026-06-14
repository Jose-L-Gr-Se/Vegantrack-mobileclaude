/**
 * Diario: navegación por fechas, comidas agrupadas, totales del día,
 * suplementos y copia de comidas. Historial free limitado a 14 días.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Button, Card, EmptyState, MacroBar, ProgressRing, SectionHeader } from '@/components/ui';
import { MEAL_ICONS, MEAL_LABELS } from '@/components/AddFoodModal';
import { fonts, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { useSupplementStore } from '@/stores/supplementStore';
import { FREE_HISTORY_DAYS, usePro } from '@/hooks/usePro';
import { addDays, daysBetween, formatDateHuman, todayISO } from '@/utils/dates';
import type { FoodLogEntry, MealType } from '@/types';
import type { MainTabParamList } from '@/navigation/types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function DiaryScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Diary'>>();
  const { user, profile } = useAuthStore();
  const { entries, selectedDate, setDate, fetchEntries, deleteEntry, getDaySummary, copyDayEntries, copyMealEntries, loadOverrides } = useDiaryStore();
  const supplements = useSupplementStore();
  const { isPro } = usePro();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void fetchEntries(user.id, selectedDate);
      void supplements.fetchSupplements(user.id);
      void supplements.fetchTodayLogs(user.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, selectedDate])
  );

  const summary = getDaySummary();

  const changeDate = (delta: number) => {
    const next = addDays(selectedDate, delta);
    if (!isPro && daysBetween(next, todayISO()) > FREE_HISTORY_DAYS) {
      Alert.alert('Historial limitado', `El plan free permite ver ${FREE_HISTORY_DAYS} días atrás. Hazte Pro para historial ilimitado.`);
      return;
    }
    setDate(next);
  };

  const meals = useMemo(() => {
    return MEAL_ORDER.map((type) => ({
      type,
      entries: entries.filter((e) => e.meal_type === type),
    }));
  }, [entries]);

  const onDelete = (entry: FoodLogEntry) => {
    Alert.alert('Eliminar', `¿Eliminar "${entry.food_name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => void deleteEntry(entry.id) },
    ]);
  };

  const copyFromYesterday = (mealType?: MealType) => {
    if (!user) return;
    const from = addDays(selectedDate, -1);
    const action = mealType
      ? copyMealEntries(user.id, from, selectedDate, mealType)
      : copyDayEntries(user.id, from, selectedDate);
    void action.then(({ count, error }) => {
      if (error) Alert.alert('Error', error);
      else if (count === 0) Alert.alert('Nada que copiar', 'Ayer no hay registros para copiar.');
    });
  };

  const onRefresh = async () => {
    if (!user) return;
    setRefreshing(true);
    await fetchEntries(user.id, selectedDate);
    setRefreshing(false);
  };

  const calTarget = profile?.calorie_target ?? 0;
  const calProgress = calTarget > 0 ? Math.min(1, summary.calories / calTarget) : 0;
  const remaining = calTarget > 0 ? Math.max(0, calTarget - Math.round(summary.calories)) : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Selector de fecha */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => changeDate(-1)} hitSlop={12}>
          <Text style={{ fontSize: 26, color: t.primary, fontWeight: '800' }}>‹</Text>
        </Pressable>
        <Pressable onLongPress={() => setDate(todayISO())}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>
            {formatDateHuman(selectedDate)}
          </Text>
        </Pressable>
        <Pressable onPress={() => changeDate(1)} hitSlop={12}>
          <Text style={{ fontSize: 26, color: t.primary, fontWeight: '800' }}>›</Text>
        </Pressable>
      </View>

      {/* Resumen del día con ring */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <ProgressRing progress={calProgress} size={80} strokeWidth={7} color={semantic.success}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: t.text }}>{Math.round(calProgress * 100)}</Text>
            <Text style={{ fontSize: 9, color: t.textMuted }}>%</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 13, color: t.textSecondary, fontWeight: '600' }}>Comido</Text>
                <Text style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: '400', color: t.text }}>
                  {Math.round(summary.calories)}
                  <Text style={{ fontSize: 13, color: t.textMuted }}> kcal</Text>
                </Text>
              </View>
              {remaining !== null ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: t.textSecondary }}>Restante</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: remaining === 0 ? semantic.success : t.text }}>
                    {remaining}
                    <Text style={{ fontSize: 11, color: t.textMuted }}> kcal</Text>
                  </Text>
                </View>
              ) : null}
            </View>
            {profile?.streak_count ? (
              <Text style={{ color: t.textSecondary, fontWeight: '700', fontSize: 12 }}>
                🔥 Racha: {profile.streak_count} días
              </Text>
            ) : null}
          </View>
        </View>
        <MacroBar label="Proteína" value={summary.protein_g} target={profile?.protein_target_g ?? 0} color={semantic.protein} />
        <MacroBar label="Carbohidratos" value={summary.carbs_g} target={profile?.carbs_target_g ?? 0} color={semantic.carbs} />
        <MacroBar label="Grasas" value={summary.fat_g} target={profile?.fat_target_g ?? 0} color={semantic.fat} />
      </Card>

      {/* Comidas */}
      {meals.map(({ type, entries: mealEntries }) => {
        const kcal = mealEntries.reduce((s, e) => s + e.calories, 0);
        return (
          <Card key={type} style={{ gap: spacing.sm }}>
            <SectionHeader
              title={`${MEAL_ICONS[type]} ${MEAL_LABELS[type]}`}
              right={
                <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                  {kcal > 0 ? <Text style={{ color: t.textMuted, fontSize: 13 }}>{Math.round(kcal)} kcal</Text> : null}
                  <Pressable onPress={() => navigation.navigate('Search', { mealType: type })} hitSlop={8}>
                    <Text style={{ color: t.primary, fontSize: 22, fontWeight: '800' }}>＋</Text>
                  </Pressable>
                </View>
              }
            />
            {mealEntries.length === 0 ? (
              <Pressable onLongPress={() => copyFromYesterday(type)}>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>
                  Sin registros · mantén pulsado para copiar de ayer
                </Text>
              </Pressable>
            ) : (
              mealEntries.map((e) => (
                <Pressable
                  key={e.id}
                  onLongPress={() => onDelete(e)}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
                >
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>
                      {e.food_name}
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                      {e.serving_size_g} g{e.brand ? ` · ${e.brand}` : ''}
                    </Text>
                  </View>
                  <Text style={{ color: t.textSecondary, fontWeight: '700' }}>{Math.round(e.calories)}</Text>
                </Pressable>
              ))
            )}
          </Card>
        );
      })}

      {/* Suplementos */}
      <Card style={{ gap: spacing.sm }}>
        <SectionHeader title="💊 Suplementos" />
        {supplements.supplements.length === 0 ? (
          <Text style={{ color: t.textMuted, fontSize: 13 }}>
            Añade tus suplementos desde Perfil.
          </Text>
        ) : (
          supplements.supplements.map((s) => {
            const taken = Boolean(supplements.takenToday[s.id]);
            return (
              <Pressable
                key={s.id}
                onPress={() => user && void supplements.toggleTaken(user.id, s.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 18 }}>{taken ? '✅' : '⬜'}</Text>
                <Text style={{ flex: 1, color: t.text, fontWeight: '600' }}>
                  {s.emoji ? `${s.emoji} ` : ''}{s.name}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                  {s.dose_amount} {s.dose_unit}
                </Text>
              </Pressable>
            );
          })
        )}
      </Card>

      <Button title="Copiar todo el día de ayer" variant="secondary" onPress={() => copyFromYesterday()} />

      {entries.length === 0 && <EmptyState emoji="🥗" text="Aún no has registrado nada hoy. Toca ＋ en una comida para buscar alimentos." />}
    </ScrollView>
  );
}
