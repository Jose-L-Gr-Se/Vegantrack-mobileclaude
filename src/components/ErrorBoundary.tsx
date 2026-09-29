/**
 * ErrorBoundary raíz. Antes de esto, un error de render en cualquier
 * pantalla dejaba la app en blanco sin que nadie se enterara (ver
 * CLAUDE.md §14, "recuperación de errores").
 *
 * No oculta el error en silencio: lo reporta vía `reportError` (que a su vez
 * no rompe nada si el SDK de crash reporting no está inicializado) y después
 * ofrece una pantalla de recuperación — nunca el stack trace al usuario.
 *
 * React sólo permite implementar un error boundary como clase
 * (`componentDidCatch` / `getDerivedStateFromError` no tienen equivalente en
 * hooks todavía), así que la pantalla de fallback en sí vive en un
 * componente funcional aparte para poder usar `useTheme()`.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing } from '@/theme';
import { Button } from '@/components/ui';
import { reportError } from '@/lib/errorReporting';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportError(error, {
      tag: 'render_error',
      extra: { componentStack: info.componentStack ?? '' },
    });
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ onRetry }: { onRetry: () => void }): React.ReactElement {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.background,
        paddingHorizontal: spacing.xl,
        gap: spacing.md,
      }}
    >
      <Text style={{ fontSize: 40 }}>🌱</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: t.text, textAlign: 'center' }}>
        Algo ha ido mal
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: t.textMuted,
          textAlign: 'center',
          maxWidth: 280,
          marginBottom: spacing.sm,
        }}
      >
        Hemos registrado el problema. Tus datos están a salvo — puedes intentarlo de nuevo.
      </Text>
      <Button title="Reintentar" onPress={onRetry} style={{ minWidth: 160 }} />
    </View>
  );
}
