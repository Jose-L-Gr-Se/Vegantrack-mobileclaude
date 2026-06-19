/** Exportación CSV del diario (compartida vía hoja nativa de Android/iOS). */
import { Share } from 'react-native';
import { supabase } from '@/lib/supabase';
import i18n from '@/i18n';
import { addDays, todayISO } from '@/utils/dates';
import { FREE_HISTORY_DAYS } from '@/hooks/usePro';
import type { FoodLogEntry } from '@/types';

const HEADERS = [
  'date', 'meal_type', 'food_name', 'brand', 'serving_size_g', 'calories',
  'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'saturated_fat_g',
  'sodium_mg', 'vitamin_b12_mcg', 'iron_mg', 'zinc_mg', 'calcium_mg',
  'omega3_g', 'vitamin_d_mcg', 'is_vegan',
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportDiaryCsv(userId: string, isPro: boolean): Promise<{ error: string | null }> {
  let query = supabase
    .from('food_log')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  // Free: solo los últimos 14 días (mismo límite que la PWA)
  if (!isPro) {
    query = query.gte('date', addDays(todayISO(), -FREE_HISTORY_DAYS));
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  const rows = (data ?? []) as FoodLogEntry[];
  const lines = [HEADERS.join(',')];
  for (const e of rows) {
    lines.push(HEADERS.map((h) => escapeCsv(e[h as keyof FoodLogEntry])).join(','));
  }
  if (!isPro) lines.push(i18n.t('exportCsv.freeSuffix', { days: FREE_HISTORY_DAYS }));

  try {
    await Share.share({
      title: `vegantrack-diario-${todayISO()}.csv`,
      message: lines.join('\n'),
    });
    return { error: null };
  } catch {
    return { error: i18n.t('exportCsv.shareError') };
  }
}
