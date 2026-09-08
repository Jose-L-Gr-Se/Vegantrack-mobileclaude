/**
 * Exportación CSV del diario.
 *
 * Auditoría de CSV/exportación (P0): antes esto compartía el CSV entero como
 * texto plano vía `Share.share({ message })`, que en Android sólo produce un
 * `Intent.ACTION_SEND` de tipo `text/plain` con el contenido metido en
 * `Intent.EXTRA_TEXT` — verificado leyendo el código nativo real de React
 * Native (`ShareModule.kt`): nunca hay `EXTRA_STREAM`, nunca hay un archivo
 * real. Con historiales largos (Pro, sin límite de días) esto arriesgaba
 * `TransactionTooLargeException` (el límite de Binder es ~1 MB compartido
 * entre transacciones concurrentes del proceso).
 *
 * Ahora se escribe un fichero `.csv` real en `Paths.cache` (expo-file-system)
 * y se comparte esa URI con `expo-sharing`, con MIME `text/csv` — ninguna
 * cantidad de filas pasa ya por un extra de `Intent`. Ambas librerías son
 * multiplataforma (Android/iOS), así que este código no necesita ningún
 * `Platform.OS` cuando llegue iOS.
 *
 * La generación del CSV (`buildDiaryCsv`, pura) está separada de la
 * escritura/compartición (`writeAndShareCsv`, con I/O real) a propósito:
 * la primera se puede testear sin mockear ningún módulo nativo.
 */
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/lib/supabase';
import { addDays, todayISO } from '@/utils/dates';
import { FREE_HISTORY_DAYS } from '@/hooks/usePro';
import type { FoodLogEntry } from '@/types';

const HEADERS = [
  'date', 'meal_type', 'food_name', 'brand', 'serving_size_g', 'calories',
  'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'saturated_fat_g',
  'sodium_mg', 'vitamin_b12_mcg', 'iron_mg', 'zinc_mg', 'calcium_mg',
  'omega3_g', 'vitamin_d_mcg', 'is_vegan',
];

// Formato de datos sin cambios en esta ronda (auditoría de CSV, alcance
// deliberadamente acotado): mismas columnas, mismo escape, mismos valores.
function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Genera el contenido CSV como string — pura, sin I/O. Mismo contrato de
 * siempre: Free añade la línea de aviso de historial recortado, Pro no. */
export function buildDiaryCsv(rows: FoodLogEntry[], isPro: boolean): string {
  const lines = [HEADERS.join(',')];
  for (const e of rows) {
    lines.push(HEADERS.map((h) => escapeCsv(e[h as keyof FoodLogEntry])).join(','));
  }
  if (!isPro) lines.push(`# Exportado con VegeTrack Free (últimos ${FREE_HISTORY_DAYS} días)`);
  return lines.join('\n');
}

export function exportFileName(date: string = todayISO()): string {
  return `vegantrack-diario-${date}.csv`;
}

/**
 * Escribe `content` en un fichero real dentro de `Paths.cache` y lo comparte
 * con la hoja nativa (`expo-sharing`), con MIME `text/csv`. Nunca pasa el
 * contenido por `Share.share`/`Intent.EXTRA_TEXT`.
 *
 * Limpieza del temporal: no se borra inmediatamente después de compartir —
 * en Android, `shareAsync()` resuelve en cuanto se entrega el intent, no
 * necesariamente cuando la app receptora ha terminado de leer los bytes
 * (Gmail/Drive/WhatsApp pueden leer el adjunto de forma asíncrona tras
 * cerrarse el selector). Borrar ahí podría romper el envío. En su lugar, se
 * borra el archivo de la exportación ANTERIOR (incluida la de hoy mismo, si
 * ya existe) justo antes de escribir uno nuevo — en ese momento el flujo de
 * compartir previo llevaba, como mínimo, el tiempo de una exportación
 * completa terminado, así que es seguro. `Paths.cache` además es un
 * directorio que el propio sistema operativo puede reclamar bajo presión de
 * almacenamiento, así que nunca queda un acumulado sin límite.
 */
export async function writeAndShareCsv(
  filename: string,
  content: string
): Promise<{ error: string | null }> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    return { error: 'Este dispositivo no permite compartir archivos ahora mismo.' };
  }

  const file = new File(Paths.cache, filename);
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(content);
  } catch {
    return { error: 'No se pudo generar el archivo de exportación.' };
  }

  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Exportar diario' });
    return { error: null };
  } catch {
    return { error: 'No se pudo compartir el archivo.' };
  }
}

/**
 * Free: últimos `FREE_HISTORY_DAYS` días. Pro: histórico completo. Mismo
 * contrato exacto que antes de esta ronda — sólo cambia cómo se entrega el
 * resultado (fichero real, no texto).
 */
export async function exportDiaryCsv(userId: string, isPro: boolean): Promise<{ error: string | null }> {
  let query = supabase
    .from('food_log')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (!isPro) {
    query = query.gte('date', addDays(todayISO(), -FREE_HISTORY_DAYS));
  }

  const { data, error } = await query;
  // Nunca el mensaje crudo de Supabase/red a la UI (CLAUDE.md §5) — el
  // detalle técnico no aporta nada aquí y antes se filtraba tal cual.
  if (error) return { error: 'No se pudo cargar tu diario. Comprueba tu conexión e inténtalo de nuevo.' };

  const csv = buildDiaryCsv((data ?? []) as FoodLogEntry[], isPro);
  return writeAndShareCsv(exportFileName(), csv);
}
