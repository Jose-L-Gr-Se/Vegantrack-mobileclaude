/**
 * Búsqueda: OpenFoodFacts (texto/barcode), frescos locales (BEDCA),
 * alimentos personalizados y recientes. Filtro vegano y alternativas veganas.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, EmptyState, Input, Pill, SectionHeader } from '@/components/ui';
import { AddFoodModal } from '@/components/AddFoodModal';
import { semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { useDiaryStore } from '@/stores/diaryStore';
import { customFoodToPer100g, useCustomFoodStore } from '@/stores/customFoodStore';
import {
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

const CONFIDENCE_LABEL: Record<VeganConfidence, { text: string; color: string }> = {
  high: { text: 'Vegano ✓', color: semantic.success },
  medium: { text: 'Parece vegano', color: semantic.warning },
  low: { text: 'No vegano', color: semantic.danger },
  unknown: { text: 'Sin datos', color: '#94a3b8' },
};

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
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<MainTabParamList, 'Search'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const user = useAuthStore((s) => s.user);
  const { recentFoods, fetchRecentFoods } = useDiaryStore();
  const customFoodStore = useCustomFoodStore();

  const [query, setQuery] = useState('');
  const [veganOnly, setVeganOnly] = useState(false);
  const [results, setResults] = useState<OpenFoodFactsProduct[]>([]);
  const [alternativesFor, setAlternativesFor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FoodPer100g | null>(null);
  const [lockedMeal, setLockedMeal] = useState<MealType | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      setLockedMeal(route.params?.mealType ?? null);
      if (user) {
        void fetchRecentFoods(user.id);
        void customFoodStore.fetchCustomFoods(user.id);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.params?.mealType, user?.id])
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
        setSelected(productToFoodPer100g(product));
      } else {
        setToast('Producto no encontrado en OpenFoodFacts');
      }
    })();
  }, [route.params?.barcode, navigation]);

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
    const alts = await findVeganAlternatives(product);
    setSearching(false);
    setResults(alts);
  };

  const freshMatches = searchFreshProduce(query);
  const customMatches = customFoodStore.searchCustomFoods(query);

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input
              label={lockedMeal ? `Añadir a ${lockedMeal === 'breakfast' ? 'Desayuno' : lockedMeal === 'lunch' ? 'Comida' : lockedMeal === 'dinner' ? 'Cena' : 'Snacks'}` : 'Buscar alimento'}
              value={query}
              onChangeText={setQuery}
              placeholder="tofu, garbanzos, bebida de soja…"
            />
          </View>
          <Pressable
            onPress={() => navigation.navigate('Scanner')}
            style={{ padding: 12, borderRadius: 16, backgroundColor: t.primarySoft }}
          >
            <Text style={{ fontSize: 22 }}>📷</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Switch value={veganOnly} onValueChange={setVeganOnly} trackColor={{ true: t.primary }} />
          <Text style={{ color: t.textSecondary, fontWeight: '600' }}>Solo veganos</Text>
          {searching ? <ActivityIndicator color={t.primary} /> : null}
        </View>

        {toast ? (
          <Pressable onPress={() => setToast(null)}>
            <Card><Text style={{ color: t.textSecondary }}>{toast}</Text></Card>
          </Pressable>
        ) : null}

        {alternativesFor ? (
          <Text style={{ color: t.textSecondary, fontWeight: '600' }}>
            🌱 Alternativas veganas a “{alternativesFor}”
          </Text>
        ) : null}

        {/* Frescos locales */}
        {freshMatches.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title="🥕 Frescos (BEDCA)" />
            {freshMatches.slice(0, 6).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setSelected(productToFoodPer100g(normalizeProduct(freshItemToProduct(item))))}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
              >
                <Text style={{ color: t.text, fontWeight: '600' }}>
                  {item.emoji} {item.name}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>{item.calories_per_100g} kcal/100g</Text>
              </Pressable>
            ))}
          </Card>
        )}

        {/* Alimentos personalizados */}
        {customMatches.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title="⭐ Mis alimentos" />
            {customMatches.slice(0, 6).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => setSelected(customFoodToPer100g(f))}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
              >
                <Text style={{ color: t.text, fontWeight: '600' }}>{f.name}</Text>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>{f.calories_per_100g} kcal/100g</Text>
              </Pressable>
            ))}
          </Card>
        )}

        {/* Resultados OFF */}
        {results.length > 0 && (
          <Card style={{ gap: 4 }}>
            <SectionHeader title={alternativesFor ? '🌱 Alternativas' : '🔍 Resultados'} />
            {results.map((p) => {
              const confidence = getVeganConfidence(p);
              const c = CONFIDENCE_LABEL[confidence];
              return (
                <Pressable
                  key={p.code}
                  onPress={() => setSelected(productToFoodPer100g(p))}
                  style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: 8, alignItems: 'center' }}
                >
                  {p.image_front_url ? (
                    <Image source={{ uri: p.image_front_url }} style={{ width: 44, height: 44, borderRadius: 10 }} />
                  ) : (
                    <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: t.separator, alignItems: 'center', justifyContent: 'center' }}>
                      <Text>🥫</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{p.product_name}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 12 }} numberOfLines={1}>
                      {p.brands || '—'} · {Math.round(p.nutriments['energy-kcal_100g'])} kcal/100g
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 2 }}>
                      <Pill text={c.text} color={c.color} />
                      {confidence === 'low' && !alternativesFor ? (
                        <Pressable onPress={() => void showAlternatives(p)} hitSlop={6}>
                          <Pill text="Ver alternativas 🌱" color={semantic.success} />
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
            <SectionHeader title="🕐 Recientes" />
            {recentFoods.map((r, i) => (
              <Pressable
                key={`${r.food_name}-${i}`}
                onPress={() => setSelected(recentToPer100g(r))}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
              >
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{r.food_name}</Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {r.brand ? `${r.brand} · ` : ''}usado {r.use_count} {r.use_count === 1 ? 'vez' : 'veces'}
                  </Text>
                </View>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>{r.calories_per_100g} kcal</Text>
              </Pressable>
            ))}
          </Card>
        )}

        {query.trim().length >= 3 && !searching && results.length === 0 && freshMatches.length === 0 && customMatches.length === 0 && (
          <EmptyState emoji="🔍" text="Sin resultados. Prueba con otro término o escanea el código de barras." />
        )}
      </ScrollView>

      {selected && (
        <AddFoodModal
          food={selected}
          lockedMealType={lockedMeal}
          onClose={() => setSelected(null)}
          onAdded={(msg) => {
            setToast(msg);
            if (user) void fetchRecentFoods(user.id);
            navigation.navigate('Main', { screen: 'Diary' });
          }}
        />
      )}
    </View>
  );
}
