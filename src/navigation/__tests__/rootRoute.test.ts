/**
 * Auditoría del bloqueo de auth/perfil — "navegación según `authPhase`",
 * probada como función pura (`resolveRootRoute`) en vez de montando
 * `NavigationContainer` con las más de 10 pantallas reales de la app.
 */
import { resolveRootRoute, shouldTrackAppOpen } from '@/navigation/rootRoute';
import type { Profile } from '@/types';
import type { User } from '@supabase/supabase-js';

const USER: User = { id: 'user-1', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' };
const PROFILE_WITH_TARGET = { calorie_target: 2000 } as unknown as Profile;
const PROFILE_WITHOUT_TARGET = { calorie_target: null } as unknown as Profile;

describe('resolveRootRoute', () => {
  it('loading → spinner, sea cual sea user/profile', () => {
    expect(resolveRootRoute({ authPhase: 'loading', user: null, profile: null })).toBe('loading');
    expect(resolveRootRoute({ authPhase: 'loading', user: USER, profile: PROFILE_WITH_TARGET })).toBe('loading');
  });

  it('recoverable_error → recovery', () => {
    expect(resolveRootRoute({ authPhase: 'recoverable_error', user: null, profile: null })).toBe('recovery');
  });

  it('authenticated_cached_profile SIN user confirmado → recovery, nunca el árbol normal', () => {
    expect(
      resolveRootRoute({ authPhase: 'authenticated_cached_profile', user: null, profile: PROFILE_WITH_TARGET })
    ).toBe('recovery');
  });

  it('authenticated_cached_profile CON user confirmado (sólo falló fetchProfile) → entra con normalidad', () => {
    expect(
      resolveRootRoute({ authPhase: 'authenticated_cached_profile', user: USER, profile: PROFILE_WITH_TARGET })
    ).toBe('main');
    // Mismo comportamiento pre-existente que ya tenía `needsOnboarding` antes
    // de esta ronda (`user && profile && !profile.calorie_target`): sin
    // `profile` en absoluto, no hay bloqueo — cae a 'main', no a
    // 'onboarding'. No es parte de esta auditoría; se deja intacto a propósito.
    expect(resolveRootRoute({ authPhase: 'authenticated_cached_profile', user: USER, profile: null })).toBe('main');
  });

  it('unauthenticated → auth', () => {
    expect(resolveRootRoute({ authPhase: 'unauthenticated', user: null, profile: null })).toBe('auth');
  });

  it('authenticated_profile_loaded sin calorie_target → onboarding', () => {
    expect(
      resolveRootRoute({ authPhase: 'authenticated_profile_loaded', user: USER, profile: PROFILE_WITHOUT_TARGET })
    ).toBe('onboarding');
  });

  it('authenticated_profile_loaded con calorie_target → main', () => {
    expect(
      resolveRootRoute({ authPhase: 'authenticated_profile_loaded', user: USER, profile: PROFILE_WITH_TARGET })
    ).toBe('main');
  });
});

describe('shouldTrackAppOpen — auditoría de medición de sesiones/retención', () => {
  it('en "main" con usuario, devuelve su userId', () => {
    expect(shouldTrackAppOpen('main', USER)).toBe('user-1');
  });

  it('en "main" sin usuario (no debería poder ocurrir, pero por si acaso), no dispara', () => {
    expect(shouldTrackAppOpen('main', null)).toBeNull();
  });

  it('en loading/auth/onboarding/recovery, nunca dispara aunque haya usuario', () => {
    expect(shouldTrackAppOpen('loading', USER)).toBeNull();
    expect(shouldTrackAppOpen('auth', USER)).toBeNull();
    expect(shouldTrackAppOpen('onboarding', USER)).toBeNull();
    expect(shouldTrackAppOpen('recovery', USER)).toBeNull();
  });
});
