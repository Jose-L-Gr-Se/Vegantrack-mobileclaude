/**
 * P0 de conectividad/configuración OFF — User-Agent.
 *
 * El dominio (.net) queda fuera de este cambio: verificado externamente que
 * responde igual que .org para el GET real de producto (ver commit). Este
 * fichero sólo cubre que los tres fetch() de openfoodfacts.ts mandan el
 * User-Agent exigido por la política de uso de OFF, sin tocar endpoints,
 * parámetros, timeouts, parseo ni manejo de errores — eso es el siguiente
 * P0 (plausibilidad/calidad de datos), fuera de alcance aquí.
 */
import {
  OFF_USER_AGENT,
  offRequestInit,
  getProductByBarcode,
  searchProducts,
  findVeganAlternatives,
  normalizeProduct,
} from '@/lib/openfoodfacts';

jest.mock('@/db/database', () => ({
  getCachedOffProduct: jest.fn().mockResolvedValue(null),
  cacheOffProduct: jest.fn().mockResolvedValue(undefined),
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('offRequestInit — única fuente del init de fetch para OFF', () => {
  it('incluye el User-Agent esperado', () => {
    const controller = new AbortController();
    const init = offRequestInit(controller.signal);
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(OFF_USER_AGENT);
  });

  it('no pierde el signal recibido (AbortController sigue funcionando)', () => {
    const controller = new AbortController();
    const init = offRequestInit(controller.signal);
    expect(init.signal).toBe(controller.signal);
  });

  it('OFF_USER_AGENT tiene el formato "VeganTrack/versión (contacto)"', () => {
    expect(OFF_USER_AGENT).toMatch(/^VeganTrack\/\d+(\.\d+)*\s\(.+\)$/);
  });
});

describe('los tres fetch() de OpenFoodFacts mandan el User-Agent esperado', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function headerFromCall(callIndex: number): string | undefined {
    const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
    return (init.headers as Record<string, string>)?.['User-Agent'];
  }

  it('getProductByBarcode', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 0 }));
    await getProductByBarcode('3017620422003');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headerFromCall(0)).toBe(OFF_USER_AGENT);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal); // no se pierde el timeout
  });

  it('searchProducts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: [], count: 0, page: 1 }));
    await searchProducts('lentejas');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(headerFromCall(0)).toBe(OFF_USER_AGENT);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('findVeganAlternatives', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: [] }));
    const original = normalizeProduct({
      code: '1',
      product_name: 'Leche entera de vaca',
      categories_tags: ['en:milk'],
      nutriments: { 'energy-kcal_100g': 60, proteins_100g: 3, carbohydrates_100g: 5, fat_100g: 3 },
    });

    await findVeganAlternatives(original);

    // El mapeo de "leche" genera varias queries → varias llamadas; TODAS
    // deben llevar el mismo User-Agent, ninguna puede quedarse sin él.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    fetchMock.mock.calls.forEach((call, i) => {
      expect(headerFromCall(i)).toBe(OFF_USER_AGENT);
      expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });
  });
});
