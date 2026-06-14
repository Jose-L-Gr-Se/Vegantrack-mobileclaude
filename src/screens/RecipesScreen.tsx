/**
 * Recetas: lista, creación, detalle con ingredientes (búsqueda OFF inline)
 * y logueo al diario por raciones. Límite free: 3 recetas.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, EmptyState, Input, SectionHeader } from '@/components/ui';
import { MEAL_LABELS } from '@/components/AddFoodModal';
import { fonts, radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';
import { computeRecipeNutrients, useRecipeStore } from '@/stores/recipeStore';
import { productToFoodPer100g, searchProducts } from '@/lib/openfoodfacts';
import { freshItemToProduct, searchFreshProduce } from '@/lib/freshProduce';
import { normalizeProduct } from '@/lib/openfoodfacts';
import { FREE_RECIPE_LIMIT, usePro } from '@/hooks/usePro';
import { todayISO } from '@/utils/dates';
import type { FoodPer100g, MealType, OpenFoodFactsProduct, Recipe } from '@/types';

export function RecipesScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuthStore();
  const store = useRecipeStore();
  const { isPro } = usePro();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [servings, setServings] = useState('2');

  const selected = store.recipes.find((r) => r.id === selectedId) ?? null;

  useFocusEffect(
    useCallback(() => {
      if (user) void store.fetchRecipes(user.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id])
  );

  const create = async () => {
    if (!user || !name.trim()) return;
    if (!isPro && store.recipes.length >= FREE_RECIPE_LIMIT) {
      Alert.alert(
        'Límite alcanzado',
        `El plan free permite ${FREE_RECIPE_LIMIT} recetas. Hazte Pro para recetas ilimitadas.`
      );
      return;
    }
    const n = Math.max(1, parseFloat(servings.replace(',', '.')) || 1);
    const { error } = await store.createRecipe(user.id, name.trim(), description.trim() || null, n);
    if (error) Alert.alert('Error', error);
    else {
      setShowCreate(false);
      setName('');
      setDescription('');
      setServings('2');
    }
  };

  if (selected) {
    return (
      <RecipeDetail
        recipe={selected}
        onBack={() => setSelectedId(null)}
        topInset={insets.top}
      />
    );
  }

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
      {/* Header row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 30, fontWeight: '400', color: t.text }}>Recetas</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Pressable
            onPress={() => setShowCreate(true)}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: radii.pill,
              backgroundColor: t.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name={'add' as any} size={22} color="#fff" />
          </Pressable>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Text style={{ color: t.primary, fontWeight: '700' }}>Cerrar</Text>
          </Pressable>
        </View>
      </View>

      {store.recipes.length === 0 ? (
        <EmptyState
          emoji="🍲"
          text="Crea recetas con sus ingredientes y loguéalas al diario en un toque."
        />
      ) : (
        store.recipes.map((r) => {
          const totals = computeRecipeNutrients(r);
          const perServing = r.total_servings > 0 ? totals.calories / r.total_servings : 0;
          const protPerServing =
            r.total_servings > 0 ? totals.protein_g / r.total_servings : 0;
          return (
            <Pressable key={r.id} onPress={() => setSelectedId(r.id)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{r.name}</Text>
                  <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {r.total_servings} raciones · {Math.round(perServing)} kcal ·{' '}
                    {Math.round(protPerServing)}g prot
                  </Text>
                </View>
                <Ionicons name={'chevron-forward' as any} size={16} color={t.textMuted} />
              </Card>
            </Pressable>
          );
        })
      )}

      {/* Create modal */}
      <Modal
        visible={showCreate}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            padding: spacing.xl,
          }}
        >
          <Card style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: t.text }}>Nueva receta</Text>
            <Input
              label="Nombre"
              value={name}
              onChangeText={setName}
              placeholder="Curry de garbanzos"
            />
            <Input
              label="Descripción (opcional)"
              value={description}
              onChangeText={setDescription}
            />
            <Input
              label="Raciones"
              value={servings}
              onChangeText={setServings}
              keyboardType="numeric"
            />
            <Button title="Crear" onPress={create} />
            <Button
              title="Cancelar"
              variant="secondary"
              onPress={() => setShowCreate(false)}
            />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}

function RecipeDetail({
  recipe,
  onBack,
  topInset,
}: {
  recipe: Recipe;
  onBack: () => void;
  topInset: number;
}) {
  const t = useTheme();
  const { user } = useAuthStore();
  const store = useRecipeStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OpenFoodFactsProduct[]>([]);
  const [pendingFood, setPendingFood] = useState<FoodPer100g | null>(null);
  const [grams, setGrams] = useState('100');
  const [logServings, setLogServings] = useState('1');
  const [logMeal, setLogMeal] = useState<MealType>('lunch');
  const [showLog, setShowLog] = useState(false);

  const totals = computeRecipeNutrients(recipe);
  const perServing = recipe.total_servings > 0 ? totals.calories / recipe.total_servings : 0;
  const protPerServing =
    recipe.total_servings > 0 ? totals.protein_g / recipe.total_servings : 0;
  const carbsPerServing =
    recipe.total_servings > 0 ? totals.carbs_g / recipe.total_servings : 0;
  const fatPerServing = recipe.total_servings > 0 ? totals.fat_g / recipe.total_servings : 0;

  const search = async () => {
    if (query.trim().length < 3) return;
    const { products } = await searchProducts(query.trim());
    setResults(products);
  };

  const addIngredient = async () => {
    if (!pendingFood) return;
    const g = parseFloat(grams.replace(',', '.'));
    if (!Number.isFinite(g) || g <= 0) return;
    const { error } = await store.addIngredient(recipe.id, pendingFood, g);
    if (error) Alert.alert('Error', error);
    setPendingFood(null);
    setGrams('100');
    setResults([]);
    setQuery('');
  };

  const logToDiary = async () => {
    if (!user) return;
    const n = parseFloat(logServings.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    const { error } = await store.logRecipe(user.id, recipe, n, logMeal, todayISO());
    if (error) Alert.alert('Error', error);
    else {
      setShowLog(false);
      Alert.alert('✓', `${recipe.name} añadida a ${MEAL_LABELS[logMeal]}`);
    }
  };

  const freshMatches = searchFreshProduce(query);

  const macroChips = [
    { label: 'KCAL', value: Math.round(perServing), color: semantic.success },
    { label: 'PROT', value: `${Math.round(protPerServing)}g`, color: semantic.protein },
    { label: 'CARBS', value: `${Math.round(carbsPerServing)}g`, color: semantic.carbs },
    { label: 'GRASA', value: `${Math.round(fatPerServing)}g`, color: '#a855f7' },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: topInset + spacing.md,
        gap: spacing.lg,
        paddingBottom: spacing.xxl,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Back + delete header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
        >
          <Ionicons name={'arrow-back' as any} size={20} color={t.primary} />
          <Text style={{ color: t.primary, fontWeight: '700', fontSize: 15 }}>Recetas</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert('Eliminar receta', `¿Eliminar "${recipe.name}"?`, [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Eliminar',
                style: 'destructive',
                onPress: () => {
                  void store.deleteRecipe(recipe.id);
                  onBack();
                },
              },
            ])
          }
          hitSlop={8}
        >
          <Text style={{ color: '#ef4444', fontWeight: '700' }}>Eliminar</Text>
        </Pressable>
      </View>

      {/* Recipe header */}
      <Card style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 26, fontWeight: '400', color: t.text }}>{recipe.name}</Text>
          {recipe.description ? (
            <Text style={{ color: t.textMuted, fontSize: 14 }}>{recipe.description}</Text>
          ) : null}
          <Text style={{ color: t.textSecondary, fontSize: 13, marginTop: 2 }}>
            {recipe.total_servings} raciones · {Math.round(totals.total_g)} g total
          </Text>
        </View>

        {/* Macro chips per serving */}
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {macroChips.map(({ label, value, color }) => (
            <View
              key={label}
              style={{
                flex: 1,
                backgroundColor: t.background,
                borderRadius: radii.sm,
                borderWidth: 1,
                borderColor: t.cardBorder,
                borderTopWidth: 2,
                borderTopColor: color,
                padding: spacing.sm,
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>{value}</Text>
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: '700',
                  letterSpacing: 0.5,
                  color: t.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
        <Text style={{ fontSize: 11, color: t.textMuted, textAlign: 'center' }}>
          por ración
        </Text>
      </Card>

      {/* Log to diary button */}
      <Button title="🍽️ Añadir al diario" onPress={() => setShowLog(true)} />

      {/* Ingredients list */}
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
          Ingredientes ({recipe.ingredients.length})
        </Text>
        <Card style={{ gap: 0, padding: 0, paddingHorizontal: spacing.lg }}>
          {recipe.ingredients.length === 0 ? (
            <Text
              style={{
                color: t.textMuted,
                fontSize: 13,
                paddingVertical: spacing.md,
              }}
            >
              Busca abajo para añadir ingredientes.
            </Text>
          ) : (
            recipe.ingredients.map((ing, idx) => {
              const ingKcal = (ing.calories_per_100g ?? 0) * (ing.serving_size_g / 100);
              return (
                <Pressable
                  key={ing.id}
                  onLongPress={() =>
                    Alert.alert('Quitar', `¿Quitar "${ing.food_name}"?`, [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Quitar',
                        style: 'destructive',
                        onPress: () => void store.removeIngredient(recipe.id, ing.id),
                      },
                    ])
                  }
                  style={{
                    height: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                    borderBottomWidth: idx < recipe.ingredients.length - 1 ? 1 : 0,
                    borderBottomColor: t.separator,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ color: t.text, fontWeight: '700', fontSize: 14 }}
                      numberOfLines={1}
                    >
                      {ing.food_name}
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                      {ing.serving_size_g} g
                    </Text>
                  </View>
                  <Text style={{ color: t.textSecondary, fontWeight: '600', fontSize: 13 }}>
                    {Math.round(ingKcal)} kcal
                  </Text>
                </Pressable>
              );
            })
          )}
        </Card>
      </View>

      {/* Add ingredient search */}
      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Añadir ingrediente" />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar alimento…"
              onSubmitEditing={search}
            />
          </View>
          <Button title="Buscar" variant="secondary" onPress={search} />
        </View>

        {freshMatches.slice(0, 4).map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              setPendingFood(productToFoodPer100g(normalizeProduct(freshItemToProduct(item))))
            }
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: t.text, fontSize: 14 }}>
              {item.emoji} {item.name}
            </Text>
          </Pressable>
        ))}
        {results.slice(0, 8).map((p) => (
          <Pressable
            key={p.code}
            onPress={() => setPendingFood(productToFoodPer100g(p))}
            style={({ pressed }) => ({
              paddingVertical: spacing.sm,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: t.text, fontSize: 14 }} numberOfLines={1}>
              {p.product_name}{' '}
              <Text style={{ color: t.textMuted, fontSize: 12 }}>({p.brands || '—'})</Text>
            </Text>
          </Pressable>
        ))}

        {pendingFood && (
          <View
            style={{
              gap: spacing.md,
              borderTopWidth: 1,
              borderTopColor: t.separator,
              paddingTop: spacing.md,
            }}
          >
            <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>
              {pendingFood.food_name}
            </Text>
            <Input
              label="Cantidad (g)"
              value={grams}
              onChangeText={setGrams}
              keyboardType="numeric"
            />
            <Button title="Añadir a la receta" onPress={addIngredient} />
          </View>
        )}
      </Card>

      {/* Log modal */}
      <Modal
        visible={showLog}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLog(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            padding: spacing.xl,
          }}
        >
          <Card style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>
              Loguear "{recipe.name}"
            </Text>

            {/* Meal selector pills */}
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
                Comida
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setLogMeal(m)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      paddingVertical: spacing.sm,
                      borderRadius: radii.pill,
                      borderWidth: 1.5,
                      borderColor: logMeal === m ? t.primary : t.cardBorder,
                      backgroundColor: logMeal === m ? t.primarySoft : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: logMeal === m ? t.primary : t.textSecondary,
                      }}
                    >
                      {MEAL_LABELS[m]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input
              label="Raciones"
              value={logServings}
              onChangeText={setLogServings}
              keyboardType="numeric"
            />
            <Button title="Añadir al diario" onPress={logToDiary} />
            <Button
              title="Cancelar"
              variant="secondary"
              onPress={() => setShowLog(false)}
            />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
