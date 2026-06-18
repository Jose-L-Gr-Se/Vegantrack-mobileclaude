import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { brand, surface } from '@/theme';

interface Props {
  children: React.ReactNode;
  /** Displayed above the generic message, e.g. "Diario" */
  screenName?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render errors inside a tab/screen so a single crash doesn't kill
 * the entire navigation tree. Uses hardcoded tokens (no hooks in class).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo) {
    if (__DEV__) {
      console.warn('[ErrorBoundary]', error, info.componentStack);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  override render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.screenName ? `en "${this.props.screenName}"` : '';

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: surface[50],
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          gap: 16,
        }}
      >
        <Text style={{ fontSize: 40 }}>🌿</Text>
        <Text
          style={{
            fontSize: 18,
            fontWeight: '700',
            color: surface[800],
            textAlign: 'center',
          }}
        >
          Algo salió mal{label ? ` ${label}` : ''}
        </Text>
        <Text
          style={{
            fontSize: 13,
            color: surface[500],
            textAlign: 'center',
            lineHeight: 18,
          }}
        >
          {__DEV__ ? this.state.message : 'Por favor toca Reintentar o reinicia la app.'}
        </Text>
        <Pressable
          onPress={this.handleRetry}
          style={({ pressed }) => ({
            marginTop: 8,
            paddingHorizontal: 28,
            paddingVertical: 12,
            borderRadius: 999,
            backgroundColor: pressed ? brand[700] : brand[600],
          })}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }
}
