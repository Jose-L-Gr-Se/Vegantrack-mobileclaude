/**
 * Búsqueda: OpenFoodFacts (texto/barcode), frescos locales (BEDCA),
 * alimentos personalizados y recientes. Filtro vegano y alternativas veganas.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, IconButton, Input, Pill, SectionHeader } from '@/components/ui';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { customFoodToPer100g, useCustomFoodStore } from '@/stores/customFoodStore';
import {
  canSuggestVeganAlternative,
  findVeganAlternatives,
  getProductByBarcode,
  getVeganConfidence,
  productToFoodPer100g,
  searchProducts,
} from '@/lib/openfoodfacts';
import { freshItemToProduct, searchFreshProduce } from '@/lib/freshProduce';
import { normalizeProduct } from '@/lib/openfoodfacts';
import type { FoodPer100g, MealType, OpenFoodFactsProduct, RecentFood, VeganConfidence } from '@/types';
import type { MainTabParamList, RootStackParamList } from '@/navigation/types';

function recentToPer100g(r: RecentFood): FoodPer100g {
  return {
    food_name: r.food_name,
    brand: r.brand,
    barcode: r.barcode,
    image_url: r.image_url,
    is_vegan: r.is_vegan,
    source: r.barcode ? 'openfoodfacts' : 'manual',
    source_ref: r.barcode,
    calories: r.calories_per_100g,
    protein_g: r.protein_per_100g,
    carbs_g: r.carbs_per_100g,
    fat_g: r.fat_per_100g,
    fiber_g: r.fiber_per_100g,
    sugar_g: r.sugar_per_100g,
    saturated_fat_g: r.saturated_fat_per_100g,
    sodium_mg: r.sodium_per_100g,
    vitamin_b12_mcg: r.vitamin_b12_mcg_per_100g,
    iron_mg: r.iron_mg_per_100g,
    zinc_mg: r.zinc_mg_per_100g,
    calcium_mg: r.calcium_mg_per_100g,
    omega3_g: r.omega3_g_per_100g,
    vitamin_d_mcg: r.vitamin_d_mcg_per_100g,
    vitamin_b12_known: r.vitamin_b12_known,
    iron_known: r.iron_known,
    zinc_known: r.zinc_known,
    calcium_known: r.calcium_known,
    omega3_known: r.omega3_known,
    vitamin_d_known: r.vitamin_d_known,
  };
}

export function SearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<MainTabParamList, 'Search'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const { recentFoods, fetchRecentFoods } = useDiaryStore();
  const customFoodStore = useCustomFoodStore();

  const [query, setQuery] = useState('');
  const [veganOnly, setVeganOnly] = useState(false);
  const [results, setResults] = useState<OpenFoodFactsProduct[]>([]);
  const [alternativesFor, setAlternativesFor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FoodPer100g | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<OpenFoodFactsProduct | null>(null);
  const [selectedConfidence, setSelectedConfidence] = useState<VeganConfidence | undefined>(undefined);
  const [lockedMeal, setLockedMeal] = useState<MealType | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confidenceColor: Record<VeganConfidence, string> = {
    high: semantic.success,
    medium: semantic.warning,
    low: semantic.danger,
    unknown: '#94a3b8',
  };

  // Datos al enfocar la pantalla.
  useFocusEffect(
    useCallback(() => {
      if (user) {
        void fetchRecentFoods(user.id);
        void customFoodStore.fetchCustomFoods(user.id);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id])
  );

  // Meal lock: aplica la comida cuando llega en la navegación (desde el
  // "+ Desayuno/Comida/…" del Diario). Se lee SIEMPRE fresco — antes un
  // useFocusEffect con deps [user] capturaba un route obsoleto y perdía el
  // mealType, por eso pedía la comida otra vez.
  useEffect(() => {
    if (route.params?.mealType) setLockedMeal(route.params.mealType);
  }, [route.params?.mealType]);

  // Al SALIR de Buscar limpiamos el lock y el param, de modo que volver a
  // entrar tocando la pestaña (sin intención de comida) vuelva a preguntar.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setLockedMeal(null);
        navigation.setParams({ mealType: undefined } as never);
      };
    }, [navigation])
  );

  // Barcode entrante desde el escáner
  useEffect(() => {
    const barcode = route.params?.barcode;
    if (!barcode) return;
    navigation.setParams({ barcode: undefined } as never);
    void (async () => {
      setSearching(true);
      const product = await getProductByBarcode(barcode);
      setSearching(false);
      if (product) {
        setSelectedProduct(product);
        setSelectedConfidence(getVeganConfidence(product));
        setSelected(productToFoodPer100g(product));
      } else {
        setToast(t('search.notFound'));
      }
    })();
  }, [route.params?.barcode, navigation, t]);

  // Búsqueda con debounce (400 ms) para no saturar la API
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setAlternativesFor(null);
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      const { products } = await searchProducts(query.trim(), 1, veganOnly);
      setSearching(false);
      setResults(products);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, veganOnly]);

  const showAlternatives = async (product: OpenFoodFactsProduct) => {
    setSearching(true);
    setAlternativesFor(product.product_name);
    setResults([]);
    const alts = await findVeganAlternatives(product);
    setSearching(false);
    setResults(alts);
    if (alts.length === 0) {
      setToast(t('search.noAlternatives'));
    }
  };

  const selectProduct = (p: OpenFoodFactsProduct) => {
    setSelectedProduct(p);
    setSelectedConfidence(getVeganConfidence(p));
    setSelected(productToFoodPer100g(p));
  };

  const closeSheet = () => {
    setSelected(null);
    setSelectedProduct(null);
    setSelectedConfidence(undefined);
  };

  const freshMatches = searchFreshProduce(query);
  const customMatches = customFoodStore.searchCustomFoods(query);

  // Profile for macro targets in the sheet
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input
              label={lockedMeal ? t('search.addToMeal', { meal: t(`meals.${lockedMeal}` as any) }) : t('search.label')}
              value={query}
              onChangeText={setQuery}
              placeholder={t('search.placeholder')}
            />
          </View>
          <IconButton
            onPress={() => navigation.navigate('Scanner', lockedMeal ? { mealType: lockedMeal } : undefined)}
            style={{ backgroundColor: theme.primarySoft, borderRadius: 16, padding: 12 }}
          >
            <Ionicons name={'barcode-outline' as any} size={22} color={theme.primary} />
          </IconButton>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Switch value={veganOnly} onValueChange={setVeganOnly} trackColor={{ true: theme.primary }} />
          <Text style={{ color: theme.textSecondary, fontWeight: '600' }}>{t('search.veganOnly')}</Text>
          {searching ? <ActivityIndicator color={theme.primary} /> : null}
        </View>

        {toast ? (
          <Pressable onPress={() => setToast(null)}>
            <Card><Text style={{ color: theme.textSecondary }}>{toast}</Text></Card>
          </Pressable>
        ) : null}

        {alternativesFor ? (
          <Text style={{ color: theme.textSecondary, fontWeight: '600' }}>
            {t('search.alternativesFor', { name: alternativesFor })}
          </Text>
        ) : null}

        {/* Frescos locales */}
        {freshMatches.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title={t('search.fresh')} />
            {freshMatches.slice(0, 6).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setSelected(productToFoodPer100g(normalizeProduct(freshItemToProduct(item))))}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 13 }}>{item.calories_per_100g} kcal/100g</Text>
              </Pressable>
            ))}
          </Card>
        )}

        {/* Alimentos personalizados */}
        {customMatches.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title={t('search.custom')} />
            {customMatches.slice(0, 6).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => setSelected(customFoodToPer100g(f))}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
              >
                <Text style={{ color: theme.text, fontWeight: '600' }}>{f.name}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 13 }}>{f.calories_per_100g} kcal/100g</Text>
              </Pressable>
            ))}
          </Card>
        )}

        {/* Resultados OFF */}
        {results.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title={alternativesFor ? t('search.alternatives') : t('search.results')} />
            {results.map((p) => {
              const confidence = getVeganConfidence(p);
              return (
                <Pressable
                  key={p.code}
                  onPress={() => selectProduct(p)}
                  style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: 10, alignItems: 'center' }}
                >
                  {p.image_front_url ? (
                    <Image source={{ uri: p.image_front_url }} style={{ width: 48, height: 48, borderRadius: 12 }} />
                  ) : (
                    <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: theme.separator, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 22 }}>🥫</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>
                      {p.product_name}
                    </Text>
                    <Text style={{ color: theme.textMuted, fontSize: 12 }} numberOfLines={1}>
                      {p.brands || '—'} · {Math.round(p.nutriments['energy-kcal_100g'])} kcal/100g
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 2, flexWrap: 'wrap' }}>
                      <Pill text={t(`search.confidence.${confidence}` as any)} color={confidenceColor[confidence]} />
                      {!alternativesFor && canSuggestVeganAlternative(p) ? (
                        <Pressable onPress={() => void showAlternatives(p)} hitSlop={6}>
                          <Pill text="Alternativas 🌱" color={semantic.success} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}

        {/* Recientes */}
        {query.trim().length < 3 && recentFoods.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title={t('search.recent')} />
            {recentFoods.map((r, i) => (
              <Pressable
                key={`${r.food_name}-${i}`}
                onPress={() => setSelected(recentToPer100g(r))}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, alignItems: 'center' }}
              >
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={{ color: theme.text, fontWeight: '600' }} numberOfLines={1}>{r.food_name}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                    {r.brand ? `${r.brand} · ` : ''}{r.calories_per_100g} kcal/100g
                  </Text>
                </View>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {t('search.usedCount', { count: r.use_count })}
                </Text>
              </Pressable>
            ))}
          </Card>
        )}

        {query.trim().length >= 3 && !searching && results.length === 0 && freshMatches.length === 0 && customMatches.length === 0 && (
          <EmptyState emoji="🔍" text={t('search.noResults')} />
        )}
      </ScrollView>

      {selected && (
        <ProductDetailSheet
          food={selected}
          offProduct={selectedProduct}
          lockedMealType={lockedMeal}
          veganConfidence={selectedConfidence}
          profile={sheetProfile}
          onClose={closeSheet}
          onAdded={(msg) => {
            setToast(msg);
            if (user) void fetchRecentFoods(user.id);
            navigation.navigate('Main', { screen: 'Diary' });
          }}
          onShowAlternatives={(product) => {
            closeSheet();
            void showAlternatives(product);
          }}
        />
      )}
    </View>
  );
}
