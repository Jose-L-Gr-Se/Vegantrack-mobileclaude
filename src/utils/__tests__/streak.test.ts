/**
 * Racha efectiva al leer — `profiles.streak_count` es la racha que TERMINA en
 * `last_log_date`; no se recalcula por el paso del tiempo, así que al mostrarla
 * se decide si sigue viva (último registro hoy o ayer) o ya se rompió.
 */
import { effectiveStreak } from '@/utils/streak';

const TODAY = '2026-09-29';

describe('effectiveStreak', () => {
  it('vigente: último registro HOY → usa streak_count', () => {
    expect(effectiveStreak(6, '2026-09-29', TODAY)).toBe(6);
  });

  it('vigente: último registro AYER (aún puede continuarse hoy) → usa streak_count', () => {
    expect(effectiveStreak(6, '2026-09-28', TODAY)).toBe(6);
  });

  it('rota: último registro hace 2 días → 0, aunque streak_count siga guardado', () => {
    expect(effectiveStreak(10, '2026-09-27', TODAY)).toBe(0);
  });

  it('rota: un hueco mucho mayor → 0', () => {
    expect(effectiveStreak(45, '2026-06-01', TODAY)).toBe(0);
  });

  it('tolera un last_log_date de "mañana" (fecha local por delante de la del servidor) → vigente', () => {
    expect(effectiveStreak(3, '2026-09-30', TODAY)).toBe(3);
  });

  it('cambia con la fecha de referencia sin mutar nada: la misma racha guardada vive hoy y está rota tres días después', () => {
    expect(effectiveStreak(6, '2026-09-28', '2026-09-29')).toBe(6);
    expect(effectiveStreak(6, '2026-09-28', '2026-10-02')).toBe(0);
  });

  it('sin racha o sin fecha → 0 (nunca inventa una racha)', () => {
    expect(effectiveStreak(0, '2026-09-29', TODAY)).toBe(0);
    expect(effectiveStreak(null, '2026-09-29', TODAY)).toBe(0);
    expect(effectiveStreak(undefined, '2026-09-29', TODAY)).toBe(0);
    expect(effectiveStreak(5, null, TODAY)).toBe(0);
    expect(effectiveStreak(5, undefined, TODAY)).toBe(0);
    expect(effectiveStreak(-2, '2026-09-29', TODAY)).toBe(0);
  });
});
