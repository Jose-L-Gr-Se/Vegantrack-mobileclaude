import { isTransientSyncError } from '@/utils/syncError';

describe('isTransientSyncError', () => {
  it('sin error → false (no hay nada que clasificar)', () => {
    expect(isTransientSyncError(null)).toBe(false);
    expect(isTransientSyncError(undefined)).toBe(false);
  });

  it('código vacío o ausente → transitorio (fetch nunca recibió respuesta del servidor)', () => {
    expect(isTransientSyncError({ code: '', message: 'FetchError: Network request failed' })).toBe(true);
    expect(isTransientSyncError({ message: 'Network request failed' })).toBe(true);
    expect(isTransientSyncError({ code: null, message: 'aborted' })).toBe(true);
  });

  it('cualquier código real de Postgres/PostgREST → NO transitorio (el servidor sí respondió)', () => {
    expect(isTransientSyncError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isTransientSyncError({ code: '23503', message: 'foreign key violation' })).toBe(false);
    expect(isTransientSyncError({ code: '42501', message: 'permission denied (RLS)' })).toBe(false);
    expect(isTransientSyncError({ code: 'PGRST116', message: 'no rows' })).toBe(false);
  });
});
