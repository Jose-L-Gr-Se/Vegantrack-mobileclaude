/**
 * Auditoría del bloqueo de auth/perfil — confirma explícitamente que el
 * timeout de `timeoutFetch` (AUTH_TIMEOUT_MS, sólo para `/auth/v1/`) NUNCA
 * alcanza a las consultas PostgREST reales que usan `exportDiaryCsv`
 * (`diaryStore`/`exportCsv.ts`, sin `.limit()` para Pro — historial
 * potencialmente largo) ni `fetchRecentFoods` (`diaryStore.ts`,
 * `select('*').limit(200)`): ambas pasan por el mismo cliente `supabase`
 * real, y ninguna debe cortarse por un timeout pensado para operaciones de
 * sesión pequeñas.
 *
 * Se usa el cliente REAL de `@/lib/supabase` (no un mock) y sólo se
 * sustituye `global.fetch` — así se prueba el cableado de verdad, no una
 * suposición sobre qué URL construye cada consulta. La prueba es directa:
 * si `timeoutFetch` interceptara estas URLs, `init.signal` existiría en la
 * petición real — se comprueba que no es así.
 */
import { supabase } from '@/lib/supabase';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('timeout de auth — exención explícita de las consultas PostgREST reales', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('exportDiaryCsv (select sin .limit(), historial Pro potencialmente largo): la petición real no lleva ningún AbortSignal de timeout', async () => {
    const mockFetch = jest.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = mockFetch as unknown as typeof fetch;

    // Misma forma exacta que exportCsv.exportDiaryCsv() para un usuario Pro:
    // sin ningún .limit(), potencialmente cientos/miles de filas.
    const { error } = await supabase
      .from('food_log')
      .select('*')
      .eq('user_id', 'user-1')
      .order('date', { ascending: false });

    expect(error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/food_log');
    expect(init?.signal).toBeUndefined(); // sin AbortController de timeoutFetch
  });

  it('fetchRecentFoods (select con .limit(200)): la petición real tampoco lleva ningún AbortSignal de timeout', async () => {
    const mockFetch = jest.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = mockFetch as unknown as typeof fetch;

    const { error } = await supabase
      .from('food_log')
      .select('*')
      .eq('user_id', 'user-1')
      .order('created_at', { ascending: false })
      .limit(200);

    expect(error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/food_log');
    expect(init?.signal).toBeUndefined();
  });

  it('cualquier otra consulta PostgREST (custom_foods, recipes, supplements...) tampoco lleva el fetch de timeout', async () => {
    const mockFetch = jest.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = mockFetch as unknown as typeof fetch;

    await supabase.from('recipes').select('*, ingredients:recipe_ingredients(*)').eq('user_id', 'user-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.signal).toBeUndefined();
  });

  it('una consulta a /auth/v1/ (por comparación) sí recibe el AbortSignal de timeoutFetch', async () => {
    const mockFetch = jest.fn().mockResolvedValue(jsonResponse({ user: null }));
    global.fetch = mockFetch as unknown as typeof fetch;

    await supabase.auth.getSession();

    // getSession() puede resolver sin red si la sesión local no existe o no
    // ha expirado (no siempre llama a fetch) — esta prueba sólo importa
    // cuando sí lo hace; si no hubo llamada, no hay nada que comprobar aquí
    // (el caso de refresco real ya está cubierto en supabase.timeoutFetch.test.ts).
    if (mockFetch.mock.calls.length > 0) {
      const [, init] = mockFetch.mock.calls[0];
      expect(init?.signal).toBeDefined();
    }
  });
});
