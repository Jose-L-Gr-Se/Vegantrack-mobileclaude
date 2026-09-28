/**
 * Auditoría de navegación/modales — igual que `EditProfileModal`/
 * `CustomFoodModal` (ver `ProfileScreen.modalCloseWhileSaving.test.tsx`),
 * `SupplementEditor` cerraba el `BottomSheet` (tap fuera, tap en el handle,
 * deslizar, botón atrás) sin comprobar `saving`. El botón "Guardar" ya se
 * deshabilitaba con `loading={saving}`, pero cerrar por cualquier otra vía
 * mientras `onSave()` seguía en vuelo no cancelaba nada: el suplemento se
 * guardaba igual en segundo plano tras desaparecer la UI.
 *
 * `BottomSheet` se mockea igual que en `ProfileScreen.modalCloseWhileSaving.
 * test.tsx`: sigue renderizando `children`/`footer` y se localiza por tipo
 * para leer/invocar directamente su prop `onClose`, simulando cualquiera de
 * los 4 gestos de cierre reales sin reimplementarlos.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SupplementEditor, type SupplementDraft } from '@/components/SupplementEditor';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/db/database', () => ({ kvGet: jest.fn(), kvSet: jest.fn() }));

jest.mock('@/components/BottomSheet', () => ({
  BottomSheet: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
import { BottomSheet } from '@/components/BottomSheet';

const DRAFT: SupplementDraft = {
  name: 'B12',
  emoji: '💊',
  nutrient_key: 'vitamin_b12_mcg',
  dose_amount: 25,
  dose_unit: 'mcg',
};

function findButtonByTitle(renderer: TestRenderer.ReactTestRenderer, title: string) {
  const [button] = renderer.root.findAll(
    (n) =>
      typeof n.type === 'function' &&
      (n.type as { name?: string }).name === 'Button' &&
      typeof n.props.onPress === 'function' &&
      n.props.title === title
  );
  return button;
}

function renderEditor(onClose: () => void, onSave: (draft: SupplementDraft) => Promise<{ error: string | null }>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <SupplementEditor initial={DRAFT} visible onClose={onClose} onSave={onSave} />
    );
  });
  return renderer;
}

describe('SupplementEditor — cerrar el sheet (tap fuera/deslizar/atrás) mientras se guarda no debe descartar la UI en silencio', () => {
  it('el cierre "ambiente" del sheet no cierra mientras onSave() está en vuelo, pero sí una vez terminado', async () => {
    let resolveSave!: (v: { error: null }) => void;
    const onSave = jest.fn(() => new Promise<{ error: null }>((resolve) => { resolveSave = resolve; }));
    const onClose = jest.fn();
    const renderer = renderEditor(onClose, onSave);

    act(() => { findButtonByTitle(renderer, 'Guardar').props.onPress(); });

    const [sheet] = renderer.root.findAllByType(BottomSheet);
    act(() => sheet.props.onClose());
    expect(onClose).not.toHaveBeenCalled();

    // Al terminar con éxito, submit() ya cierra por sí solo — el intento de
    // cierre bloqueado arriba no debe sumarse a esa única llamada real.
    await act(async () => {
      resolveSave({ error: null });
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('comportamiento normal (sin guardado en curso): el cierre del sheet cierra de inmediato', () => {
    const onClose = jest.fn();
    const renderer = renderEditor(onClose, jest.fn());

    const [sheet] = renderer.root.findAllByType(BottomSheet);
    act(() => sheet.props.onClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
