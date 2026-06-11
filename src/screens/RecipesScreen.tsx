/**
 * Recetas: lista, creación, detalle con ingredientes (búsqueda OFF inline)
 * y logueo al diario por raciones. Límite free: 3 recetas.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Button, Card, EmptyState, Input, SectionHeader } from '@/components/ui';
import { MEAL_LABELS } from '@/components/AddFoodModal';
import { radii, spacing, useTheme } from '@/theme';
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
      Alert.alert('Límite alcanzado', `El plan free permite ${FREE_RECIPE_LIMIT} recetas. Hazte Pro para recetas ilimitadas.`);
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
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>🍲 Recetas</Text>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={{ color: t.primary, fontWeight: '700' }}>Cerrar</Text>
        </Pressable>
      </View>

      <Button title="＋ Nueva receta" onPress={() => setShowCreate(true)} />

      {store.recipes.length === 0 ? (
        <EmptyState emoji="🍲" text="Crea recetas con sus ingredientes y loguéalas al diario en un toque." />
      ) : (
        store.recipes.map((r) => {
          const totals = computeRecipeNutrients(r);
          const perServing = r.total_servings > 0 ? totals.calories / r.total_servings : 0;
          return (
            <Pressable key={r.id} onPress={() => setSelectedId(r.id)}>
              <Card style={{ gap: 4 }}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{r.name}</Text>
                <Text style={{ color: t.textMuted, fontSize: 13 }}>
                  {r.ingredients.length} ingredientes · {r.total_servings} raciones · {Math.round(perServing)} kcal/ración
                </Text>
              </Card>
            </Pressable>
          );
        })
      )}

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.xl }}>
          <Card style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>Nueva receta</Text>
            <Input label="Nombre" value={name} onChangeText={setName} placeholder="Curry de garbanzos" />
            <Input label="Descripción (opcional)" value={description} onChangeText={setDescription} />
            <Input label="Raciones" value={servings} onChangeText={setServings} keyboardType="numeric" />
            <Button title="Crear" onPress={create} />
            <Button title="Cancelar" variant="secondary" onPress={() => setShowCreate(false)} />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}

function RecipeDetail({ recipe, onBack, topInset }: { recipe: Recipe; onBack: () => void; topInset: number }) {
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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: topInset + spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={{ color: t.primary, fontWeight: '700' }}>‹ Recetas</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert('Eliminar receta', `¿Eliminar "${recipe.name}"?`, [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Eliminar', style: 'destructive', onPress: () => { void store.deleteRecipe(recipe.id); onBack(); } },
            ])
          }
          hitSlop={8}
        >
          <Text style={{ color: '#ef4444', fontWeight: '700' }}>Eliminar</Text>
        </Pressable>
      </View>

      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: t.text }}>{recipe.name}</Text>
        {recipe.description ? <Text style={{ color: t.textMuted }}>{recipe.description}</Text> : null}
        <Text style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}>
          Total: {Math.round(totals.total_g)} g · {Math.round(totals.calories)} kcal · P {Math.round(totals.protein_g)} g · C{' '}
          {Math.round(totals.carbs_g)} g · G {Math.round(totals.fat_g)} g
        </Text>
        <Text style={{ color: t.textMuted, fontSize: 13 }}>
          {recipe.total_servings} raciones · {Math.round(totals.calories / recipe.total_servings)} kcal/ración
        </Text>
      </Card>

      <Button title="🍽️ Añadir al diario" onPress={() => setShowLog(true)} />

      <Card style={{ gap: spacing.sm }}>
        <SectionHeader title="Ingredientes" />
        {recipe.ingredients.length === 0 ? (
          <Text style={{ color: t.textMuted, fontSize: 13 }}>Busca abajo para añadir ingredientes.</Text>
        ) : (
          recipe.ingredients.map((ing) => (
            <Pressable
              key={ing.id}
              onLongPress={() =>
                Alert.alert('Quitar', `¿Quitar "${ing.food_name}"?`, [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Quitar', style: 'destructive', onPress: () => void store.removeIngredient(recipe.id, ing.id) },
                ])
              }
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
            >
              <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{ing.food_name}</Text>
              <Text style={{ color: t.textMuted }}>{ing.serving_size_g} g</Text>
            </Pressable>
          ))
        )}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <SectionHeader title="Añadir ingrediente" />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Input value={query} onChangeText={setQuery} placeholder="Buscar alimento…" onSubmitEditing={search} />
          </View>
          <Button title="Buscar" variant="secondary" onPress={search} />
        </View>

        {freshMatches.slice(0, 4).map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setPendingFood(productToFoodPer100g(normalizeProduct(freshItemToProduct(item))))}
            style={{ paddingVertical: 6 }}
          >
            <Text style={{ color: t.text }}>{item.emoji} {item.name}</Text>
          </Pressable>
        ))}
        {results.slice(0, 8).map((p) => (
          <Pressable key={p.code} onPress={() => setPendingFood(productToFoodPer100g(p))} style={{ paddingVertical: 6 }}>
            <Text style={{ color: t.text }} numberOfLines={1}>{p.product_name} <Text style={{ color: t.textMuted, fontSize: 12 }}>({p.brands || '—'})</Text></Text>
          </Pressable>
        ))}

        {pendingFood && (
          <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: t.separator, paddingTop: spacing.md }}>
            <Text style={{ color: t.text, fontWeight: '700' }}>{pendingFood.food_name}</Text>
            <Input label="Cantidad (g)" value={grams} onChangeText={setGrams} keyboardType="numeric" />
            <Button title="Añadir a la receta" onPress={addIngredient} />
          </View>
        )}
      </Card>

      <Modal visible={showLog} transparent animationType="slide" onRequestClose={() => setShowLog(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.xl }}>
          <Card style={{ gap: spacing.md }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: t.text }}>Loguear "{recipe.name}"</Text>
            <Input label="Raciones" value={logServings} onChangeText={setLogServings} keyboardType="numeric" />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(Object.keys(MEAL_LABELS) as MealType[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setLogMeal(m)}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    paddingVertical: spacing.sm,
                    borderRadius: radii.md,
                    borderWidth: 2,
                    borderColor: logMeal === m ? t.primary : t.cardBorder,
                  }}
                >
                  <Text style={{ fontSize: 11, color: t.textSecondary, fontWeight: '600' }}>{MEAL_LABELS[m]}</Text>
                </Pressable>
              ))}
            </View>
            <Button title="Añadir al diario" onPress={logToDiary} />
            <Button title="Cancelar" variant="secondary" onPress={() => setShowLog(false)} />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
