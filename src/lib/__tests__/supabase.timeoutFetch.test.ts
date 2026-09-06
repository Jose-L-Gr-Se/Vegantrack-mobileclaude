/**
 * Auditoría del bloqueo de auth/perfil — mecanismo de cancelación real de
 * `timeoutFetch` (src/lib/supabase.ts). Se importa el módulo REAL (no un
 * mock): ya se comprobó que carga limpio bajo Jest, y es la única forma de
 * probar de verdad el `AbortController` sin reimplementarlo en el test.
 *
 * `global.fetch` se sustituye por un doble controlable — nunca se hace una
 * petición de red real.
 */
import { AUTH_PATH_PREFIX, AUTH_TIMEOUT_MS, timeoutFetch } from '@/lib/supabase';

const AUTH_URL = `${AUTH_PATH_PREFIX}token?grant_type=refresh_token`;
const POSTGREST_URL = AUTH_PATH_PREFIX.replace('/auth/v1/', '/rest/v1/profiles');

describe('timeoutFetch', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('URLs fuera de /auth/v1/ (Postgrest, Functions) pasan sin ningún timeout — nunca se les aplica AbortController', async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response('ok'));
    global.fetch = mockFetch as unknown as typeof fetch;

    await timeoutFetch(POSTGREST_URL, { method: 'GET' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    // Se reenvía tal cual: sin `signal` añadido por timeoutFetch.
    expect(init?.signal).toBeUndefined();
  });

  it('una petición de auth colgada (ni resuelve ni falla) se aborta a los AUTH_TIMEOUT_MS y nunca se queda pendiente para siempre', async () => {
    let capturedSignal: AbortSignal | undefined;
    const hungFetch = jest.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      // Simula una conexión TCP que nunca resuelve ni rechaza por sí sola —
      // sólo termina si el `signal` se aborta.
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    global.fetch = hungFetch as unknown as typeof fetch;

    const promise = timeoutFetch(AUTH_URL, {});
    // Antes del timeout: la promesa no se ha resuelto (no hay forma directa
    // de comprobar "está pendiente" con fake timers sin una carrera; se
    // verifica indirectamente más abajo con el resultado final).
    expect(capturedSignal?.aborted).toBe(false);

    jest.advanceTimersByTime(AUTH_TIMEOUT_MS);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('éxito antes del timeout: limpia el temporizador y no aborta después', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const mockFetch = jest.fn().mockResolvedValue(new Response('ok'));
    global.fetch = mockFetch as unknown as typeof fetch;

    const res = await timeoutFetch(AUTH_URL, {});
    expect(res.ok).toBe(true);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Avanzar el reloj después de resolver no debe tener ningún efecto
    // observable (el timer ya se limpió) — sólo comprobamos que no explota.
    jest.advanceTimersByTime(AUTH_TIMEOUT_MS * 2);
    clearTimeoutSpy.mockRestore();
  });

  it('conserva una AbortSignal externa: si el llamador aborta la suya, la petición real también se cancela', async () => {
    let capturedSignal: AbortSignal | undefined;
    const hungFetch = jest.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    global.fetch = hungFetch as unknown as typeof fetch;

    const externalController = new AbortController();
    const promise = timeoutFetch(AUTH_URL, { signal: externalController.signal });

    // El llamador aborta ANTES de que salte nuestro propio timeout de 6 s.
    externalController.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(true);

    // Nuestro propio timer no debe seguir pendiente después de esto.
    jest.advanceTimersByTime(AUTH_TIMEOUT_MS);
  });

  it('si la señal externa ya viene abortada de entrada, la petición se cancela de inmediato', async () => {
    let capturedSignal: AbortSignal | undefined;
    const hungFetch = jest.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        if (capturedSignal?.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        capturedSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    global.fetch = hungFetch as unknown as typeof fetch;

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();

    await expect(timeoutFetch(AUTH_URL, { signal: alreadyAborted.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
