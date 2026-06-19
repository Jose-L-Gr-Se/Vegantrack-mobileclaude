/**
 * Diario: navegación por fechas, comidas agrupadas, totales del día,
 * suplementos y copia de comidas. Historial free limitado a 14 días.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, MacroBar, ProgressRing, SectionHeader } from '@/components/ui';
import { MEAL_ICONS } from '@/components/AddFoodModal';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { ProModal } from '@/components/ProModal';
import { SwipeableRow } from '@/components/SwipeableRow';
import { SupplementEditor } from '@/components/SupplementEditor';
import { BottomSheet } from '@/components/BottomSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { SUPPLEMENT_PRESETS, useSupplementStore } from '@/stores/supplementStore';
import { useMealPhoto } from '@/hooks/useMealPhoto';
import { track, trackAppOpenOnce } from '@/lib/analytics';
import { FREE_HISTORY_DAYS, FREE_SUPPLEMENT_LIMIT, usePro } from '@/hooks/usePro';
import { addDays, daysBetween, formatDateHuman, todayISO } from '@/utils/dates';
import type { FoodLogEntry, MealType, Supplement } from '@/types';
import type { MainTabParamList } from '@/navigation/types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function DiaryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList, 'Diary'>>();
  const { user, profile } = useAuthStore();
  const { entries, selectedDate, setDate, fetchEntries, deleteEntry, getDaySummary, copyDayEntries, copyMealEntries, loadOverrides } = useDiaryStore();
  const supplements = useSupplementStore();
  const { isPro } = usePro();
  const photo = useMealPhoto();
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<FoodLogEntry | null>(null);

  // Abre el paywall cuando se agota la cuota gratuita de fotos.
  useEffect(() => {
    if (photo.quotaBlocked) track('paywall_viewed', { source: 'photo_quota' });
  }, [photo.quotaBlocked]);

  const startPhoto = () => {
    Alert.alert(t('diary.analyzeTitle'), t('diary.analyzePickMsg'), [
      { text: t('diary.photoCamera'), onPress: () => void photo.capture('camera') },
      { text: t('diary.photoGallery'), onPress: () => void photo.capture('library') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const sheetProfile =
    profile?.calorie_target != null &&
    profile?.protein_target_g != null &&
    profile?.carbs_target_g != null &&
    profile?.fat_target_g != null
      ? {
          calorie_target: profile.calorie_target,
          protein_target_g: profile.protein_target_g,
          carbs_target_g: profile.carbs_target_g,
          fat_target_g: profile.fat_target_g,
        }
      : null;

  // Aviso de la ficha tras analizar una foto: si hay ingredientes de origen
  // animal, se muestra como dato suave e informativo (no bloquea ni juzga);
  // si no, los supuestos de la estimación.
  const photoNotice: { tone: 'warn' | 'info'; text: string } | null = photo.analysis
    ? !photo.analysis.is_vegan && photo.analysis.non_vegan_ingredients?.length
      ? {
          tone: 'info',
          text: `Posibles ingredientes de origen animal: ${photo.analysis.non_vegan_ingredients.join(
            ', '
          )} (sólo informativo).`,
        }
      : photo.analysis.notes
      ? { tone: 'info', text: photo.analysis.notes }
      : null
    : null;

  // Editor de suplementos en línea desde el Diario (sin ir a Perfil).
  // Estado posible:
  //   · null            → sin editor abierto.
  //   · 'picker'        → hoja con presets para elegir uno.
  //   · 'new'           → editor en blanco (creación personalizada).
  //   · {preset:n}      → editor con datos del preset n cargados.
  //   · Supplement      → editor de uno existente para modificarlo / borrarlo.
  const [suppEditor, setSuppEditor] = useState<
    null | 'picker' | 'new' | { preset: number } | Supplement
  >(null);

  const tryAddSupplement = (open: () => void) => {
    if (!isPro && supplements.supplements.length >= FREE_SUPPLEMENT_LIMIT) {
      Alert.alert(
        t('diary.limitTitle'),
        t('diary.limitMsg', { count: FREE_SUPPLEMENT_LIMIT })
      );
      return;
    }
    open();
  };

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      trackAppOpenOnce();
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
      Alert.alert(
        t('diary.historyLimitTitle'),
        t('diary.historyLimitMsg', { count: FREE_HISTORY_DAYS })
      );
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
    Alert.alert(t('diary.deleteTitle'), t('diary.deleteConfirm', { name: entry.food_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void deleteEntry(entry.id) },
    ]);
  };

  const copyFromYesterday = (mealType?: MealType) => {
    if (!user) return;
    const from = addDays(selectedDate, -1);
    const action = mealType
      ? copyMealEntries(user.id, from, selectedDate, mealType)
      : copyDayEntries(user.id, from, selectedDate);
    void action.then(({ count, error }) => {
      if (error) Alert.alert(t('common.error'), error);
      else if (count === 0) Alert.alert(t('diary.nothingToCopy'), t('diary.nothingToCopyMsg'));
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
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Selector de fecha */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => changeDate(-1)} hitSlop={12}>
          <Text style={{ fontSize: 26, color: theme.primary, fontWeight: '800' }}>‹</Text>
        </Pressable>
        <Pressable onLongPress={() => setDate(todayISO())}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: theme.text }}>
            {formatDateHuman(selectedDate)}
          </Text>
        </Pressable>
        <Pressable onPress={() => changeDate(1)} hitSlop={12}>
          <Text style={{ fontSize: 26, color: theme.primary, fontWeight: '800' }}>›</Text>
        </Pressable>
      </View>

      {/* Resumen del día con ring */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <ProgressRing progress={calProgress} size={80} strokeWidth={7} color={semantic.success}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: theme.text }}>{Math.round(calProgress * 100)}</Text>
            <Text style={{ fontSize: 9, color: theme.textMuted }}>%</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 13, color: theme.textSecondary, fontWeight: '600' }}>{t('diary.eaten')}</Text>
                <Text style={{ fontSize: 26, fontWeight: '800', color: theme.text }}>
                  {Math.round(summary.calories)}
                  <Text style={{ fontSize: 13, color: theme.textMuted }}> kcal</Text>
                </Text>
              </View>
              {remaining !== null ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: theme.textSecondary }}>{t('diary.remaining')}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: remaining === 0 ? semantic.success : theme.text }}>
                    {remaining}
                    <Text style={{ fontSize: 11, color: theme.textMuted }}> kcal</Text>
                  </Text>
                </View>
              ) : null}
            </View>
            {profile?.streak_count ? (
              <Text style={{ color: theme.textSecondary, fontWeight: '700', fontSize: 12 }}>
                {t('diary.streakBadge', { count: profile.streak_count })}
              </Text>
            ) : null}
          </View>
        </View>
        <MacroBar label="Proteína" value={summary.protein_g} target={profile?.protein_target_g ?? 0} color={semantic.protein} />
        <MacroBar label="Carbohidratos" value={summary.carbs_g} target={profile?.carbs_target_g ?? 0} color={semantic.carbs} />
        <MacroBar label="Grasas" value={summary.fat_g} target={profile?.fat_target_g ?? 0} color={semantic.fat} />
      </Card>

      {/* Analizar plato con IA (VeganLens) */}
      <Pressable
        onPress={startPhoto}
        disabled={photo.analyzing}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          backgroundColor: theme.primary,
          borderRadius: radii.lg,
          padding: spacing.md,
          opacity: pressed || photo.analyzing ? 0.85 : 1,
        })}
      >
        <View
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {photo.analyzing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name={'camera' as any} size={22} color="#fff" />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
            {photo.analyzing ? t('diary.analyzing') : t('diary.analyzeBtn')}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>
            {isPro
              ? t('diary.analyzeSubPro')
              : photo.remaining != null
              ? t('diary.analyzeSubFree', { remaining: photo.remaining, limit: photo.limit })
              : t('diary.analyzeSubGuest', { limit: photo.limit })}
          </Text>
        </View>
        {!photo.analyzing ? <Ionicons name={'sparkles' as any} size={18} color="#fff" /> : null}
      </Pressable>

      {/* Comidas */}
      {meals.map(({ type, entries: mealEntries }) => {
        const kcal = mealEntries.reduce((s, e) => s + e.calories, 0);
        return (
          <Card key={type} style={{ gap: spacing.sm }}>
            <SectionHeader
              title={`${MEAL_ICONS[type]} ${t(`meals.${type}` as any)}`}
              right={
                <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
                  {kcal > 0 ? <Text style={{ color: theme.textMuted, fontSize: 13 }}>{Math.round(kcal)} kcal</Text> : null}
                  <Pressable onPress={() => navigation.navigate('Search', { mealType: type })} hitSlop={8}>
                    <Text style={{ color: theme.primary, fontSize: 22, fontWeight: '800' }}>＋</Text>
                  </Pressable>
                </View>
              }
            />
            {mealEntries.length === 0 ? (
              <Pressable onLongPress={() => copyFromYesterday(type)}>
                <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                  {t('diary.noEntries')}
                </Text>
              </Pressable>
            ) : (
              mealEntries.map((e) => (
                <SwipeableRow
                  key={e.id}
                  onPress={() => setEditing(e)}
                  onDelete={() => void deleteEntry(e.id)}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 2,
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: spacing.md }}>
                      <Text style={{ color: theme.text, fontWeight: '600' }} numberOfLines={1}>
                        {e.food_name}
                      </Text>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {e.serving_size_g} g{e.brand ? ` · ${e.brand}` : ''}
                      </Text>
                    </View>
                    <Text style={{ color: theme.textSecondary, fontWeight: '700' }}>{Math.round(e.calories)}</Text>
                  </View>
                </SwipeableRow>
              ))
            )}
          </Card>
        );
      })}

      {/* Suplementos */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.8,
                color: theme.textMuted,
                textTransform: 'uppercase',
              }}
            >
              {t('diary.supplementsToday')}
            </Text>
            {supplements.supplements.length > 0 ? (
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                · {Object.keys(supplements.takenToday).length}/{supplements.supplements.length}
              </Text>
            ) : null}
          </View>
          {/* "+" para añadir sin salir del Diario */}
          <Pressable
            onPress={() => tryAddSupplement(() => setSuppEditor('picker'))}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: theme.primarySoft,
              alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name={'add' as any} size={20} color={theme.primary} />
          </Pressable>
        </View>

        {supplements.supplements.length === 0 ? (
          <Pressable
            onPress={() => setSuppEditor('picker')}
            style={({ pressed }) => ({
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: theme.cardBorder,
              borderRadius: radii.lg,
              padding: spacing.lg,
              alignItems: 'center',
              gap: 6,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name={'fitness-outline' as any} size={22} color={theme.primary} />
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700' }}>
              {t('diary.supplementStart')}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
              {t('diary.supplementStartHint')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {supplements.supplements.map((s) => {
              const taken = Boolean(supplements.takenToday[s.id]);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => user && void supplements.toggleTaken(user.id, s.id)}
                  onLongPress={() => setSuppEditor(s)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radii.lg,
                    borderWidth: 1,
                    borderColor: taken ? theme.primary : theme.cardBorder,
                    backgroundColor: taken ? theme.primarySoft : theme.card,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40, height: 40, borderRadius: 20,
                      backgroundColor: theme.background,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 20 }}>{s.emoji ?? '💊'}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: taken ? theme.primary : theme.text,
                        fontWeight: '700',
                        fontSize: 14,
                      }}
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                      {s.dose_amount} {s.dose_unit}
                    </Text>
                  </View>

                  {/* Botón para abrir el editor sin esperar al long-press */}
                  <Pressable
                    onPress={() => setSuppEditor(s)}
                    hitSlop={10}
                    style={{
                      width: 28, height: 28, borderRadius: 14,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Ionicons name={'ellipsis-horizontal' as any} size={16} color={theme.textMuted} />
                  </Pressable>

                  <View
                    style={{
                      width: 26, height: 26, borderRadius: 13,
                      borderWidth: 1.5,
                      borderColor: taken ? theme.primary : theme.cardBorder,
                      backgroundColor: taken ? theme.primary : 'transparent',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {taken ? <Ionicons name={'checkmark' as any} size={16} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            })}

            <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 4 }}>
              {t('diary.supplementHint')}
            </Text>
          </View>
        )}
      </Card>

      <Button title={t('diary.copyYesterday')} variant="secondary" onPress={() => copyFromYesterday()} />

      {entries.length === 0 && <EmptyState emoji="🥗" text={t('diary.emptyText')} />}

      {editing ? (
        <ProductDetailSheet
          editEntry={editing}
          profile={
            profile?.calorie_target != null &&
            profile?.protein_target_g != null &&
            profile?.carbs_target_g != null &&
            profile?.fat_target_g != null
              ? {
                  calorie_target: profile.calorie_target,
                  protein_target_g: profile.protein_target_g,
                  carbs_target_g: profile.carbs_target_g,
                  fat_target_g: profile.fat_target_g,
                }
              : null
          }
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          onDelete={() => void deleteEntry(editing.id)}
        />
      ) : null}

      {/* Ficha de revisión del plato analizado con IA */}
      {photo.food ? (
        <ProductDetailSheet
          food={photo.food}
          initialGrams={photo.grams}
          veganConfidence={photo.analysis?.is_vegan ? photo.confidence : undefined}
          notice={photoNotice}
          profile={sheetProfile}
          onClose={photo.reset}
          onAdded={() => {
            track('photo_entry_saved', {});
            if (user) void fetchEntries(user.id, selectedDate);
            photo.reset();
          }}
        />
      ) : null}

      {/* Paywall al agotar la cuota gratuita de fotos */}
      {photo.quotaBlocked ? <ProModal isPro={isPro} onClose={photo.clearQuota} /> : null}

      {/* Picker de suplementos (presets + crear personalizado) */}
      <SupplementPickerSheet
        visible={suppEditor === 'picker'}
        onClose={() => setSuppEditor(null)}
        onChoosePreset={(i) => setSuppEditor({ preset: i })}
        onChooseCustom={() => setSuppEditor('new')}
      />

      {/* Editor: nuevo desde preset */}
      {suppEditor && typeof suppEditor === 'object' && 'preset' in suppEditor ? (
        <SupplementEditor
          visible
          title={t('diary.addSupplement')}
          initial={{
            name: t(`supplements.preset.${SUPPLEMENT_PRESETS[suppEditor.preset].id}` as any),
            emoji: SUPPLEMENT_PRESETS[suppEditor.preset].emoji,
            nutrient_key: SUPPLEMENT_PRESETS[suppEditor.preset].nutrient_key,
            dose_amount: SUPPLEMENT_PRESETS[suppEditor.preset].dose_amount,
            dose_unit: SUPPLEMENT_PRESETS[suppEditor.preset].dose_unit,
          }}
          onClose={() => setSuppEditor(null)}
          onSave={async (draft) => {
            if (!user) return { error: t('diary.noSession') };
            return supplements.createSupplement(user.id, draft);
          }}
        />
      ) : null}

      {/* Editor: nuevo en blanco */}
      {suppEditor === 'new' ? (
        <SupplementEditor
          visible
          title={t('diary.newSupplement')}
          initial={{ name: '', emoji: '💊', nutrient_key: null, dose_amount: 1, dose_unit: 'mg' }}
          onClose={() => setSuppEditor(null)}
          onSave={async (draft) => {
            if (!user) return { error: t('diary.noSession') };
            return supplements.createSupplement(user.id, draft);
          }}
        />
      ) : null}

      {/* Editor: existente */}
      {suppEditor && typeof suppEditor === 'object' && 'id' in suppEditor ? (
        <SupplementEditor
          visible
          title={t('diary.editSupplement')}
          initial={{
            name: suppEditor.name,
            emoji: suppEditor.emoji,
            nutrient_key: suppEditor.nutrient_key,
            dose_amount: suppEditor.dose_amount,
            dose_unit: suppEditor.dose_unit,
          }}
          onClose={() => setSuppEditor(null)}
          onSave={async (draft) => supplements.updateSupplement((suppEditor as Supplement).id, draft)}
          onDelete={() => void supplements.deleteSupplement((suppEditor as Supplement).id)}
        />
      ) : null}
    </ScrollView>
  );
}

/** Hoja con presets veganos sugeridos y opción de crear uno personalizado. */
function SupplementPickerSheet({
  visible,
  onClose,
  onChoosePreset,
  onChooseCustom,
}: {
  visible: boolean;
  onClose: () => void;
  onChoosePreset: (index: number) => void;
  onChooseCustom: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text }}>
          {t('diary.addSupplement')}
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 18 }}>
          {t('diary.pickerHint')}
        </Text>

        {/* Crear personalizado destacado */}
        <Pressable
          onPress={() => {
            onClose();
            onChooseCustom();
          }}
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
          <Ionicons name={'create-outline' as any} size={18} color={theme.primary} />
          <Text style={{ color: theme.primary, fontWeight: '700', fontSize: 14 }}>
            {t('diary.createCustom')}
          </Text>
        </Pressable>

        <Text
          style={{
            fontSize: 11,
            fontWeight: '700',
            letterSpacing: 0.8,
            color: theme.textMuted,
            textTransform: 'uppercase',
            marginTop: spacing.sm,
          }}
        >
          {t('diary.typicalSupplements')}
        </Text>

        {SUPPLEMENT_PRESETS.map((p, i) => (
          <Pressable
            key={p.name}
            onPress={() => {
              onClose();
              onChoosePreset(i);
            }}
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
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: theme.background,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 20 }}>{p.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{t(`supplements.preset.${p.id}` as any)}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {t('diary.supplementSuggested', { amount: p.dose_amount, unit: p.dose_unit })}
              </Text>
            </View>
            <Ionicons name={'add-circle-outline' as any} size={20} color={theme.primary} />
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}
