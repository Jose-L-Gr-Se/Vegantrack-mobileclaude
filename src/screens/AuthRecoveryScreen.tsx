/**
 * Pantalla para los dos casos en los que `authPhase` no puede confirmar una
 * sesión por red pero tampoco es un logout real (auditoría del bloqueo de
 * auth/perfil):
 *
 *  - `recoverable_error`: ni sesión ni perfil cacheado a los que recurrir.
 *  - `authenticated_cached_profile` sin `user` confirmado: la sesión en sí
 *    no se pudo confirmar (error transitorio), pero hay un perfil cacheado
 *    del último usuario conocido — se muestra para tranquilizar, aunque no
 *    hay sesión real con la que entrar a la app todavía.
 *
 * Nunca es un spinner ni el formulario de login: es una pantalla honesta,
 * con una acción de reintento explícita.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { spacing, useTheme } from '@/theme';

export function AuthRecoveryScreen({
  cachedProfileName,
  onRetry,
}: {
  /** Nombre del perfil cacheado, si lo hay — sólo cambia el tono del mensaje. */
  cachedProfileName?: string | null;
  onRetry: () => void | Promise<void>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <Logo size={40} />
      <Card style={{ gap: spacing.md, marginTop: spacing.xl, width: '100%' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: t.text, textAlign: 'center' }}>
          {cachedProfileName ? `Hola de nuevo, ${cachedProfileName}` : 'No pudimos confirmar tu sesión'}
        </Text>
        <Text style={{ fontSize: 14, color: t.textMuted, textAlign: 'center', lineHeight: 20 }}>
          {cachedProfileName
            ? 'No hay conexión ahora mismo, pero tus datos siguen guardados en este dispositivo, tal y como los dejaste. En cuanto recuperes cobertura, vuelve a intentarlo para entrar con normalidad.'
            : 'Comprueba tu conexión e inténtalo de nuevo. No hemos podido verificar tu sesión ni encontrar ningún dato guardado en este dispositivo.'}
        </Text>
        <Button
          title="Reintentar"
          onPress={() => void handleRetry()}
          loading={retrying}
        />
      </Card>
    </View>
  );
}
