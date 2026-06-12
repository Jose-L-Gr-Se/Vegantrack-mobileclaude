import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Input } from '@/components/ui';
import { radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

// Necesario para completar la sesión OAuth en entornos web; en nativo es no-op.
WebBrowser.maybeCompleteAuthSession();

export function AuthScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signUp, signInWithGoogle } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Introduce email y contraseña');
      return;
    }
    setLoading(true);
    setError(null);
    const result =
      mode === 'login'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password);
    setLoading(false);
    if (result.error) setError(result.error);
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    const result = await signInWithGoogle();
    setGoogleLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: spacing.xl,
          paddingTop: insets.top + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ alignItems: 'center', marginBottom: spacing.xxl }}>
          <Text style={{ fontSize: 56 }}>🌱</Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: t.text }}>VeganTrack</Text>
          <Text style={{ color: t.textMuted, marginTop: 4 }}>
            Nutrición vegana, sin ruido.
          </Text>
        </View>

        <Card style={{ gap: spacing.lg }}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="tu@email.com"
          />
          <Input
            label="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
          />
          {error ? <Text style={{ color: '#ef4444', fontSize: 13 }}>{error}</Text> : null}
          <Button
            title={mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
            onPress={submit}
            loading={loading}
          />

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1, height: 1, backgroundColor: t.separator }} />
            <Text style={{ color: t.textMuted, fontSize: 12 }}>o</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: t.separator }} />
          </View>

          {/* Google sign-in */}
          <TouchableOpacity
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              height: 48,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: t.cardBorder,
              backgroundColor: t.inputBg,
              opacity: googleLoading ? 0.6 : 1,
            }}
            onPress={handleGoogle}
            disabled={googleLoading || loading}
            activeOpacity={0.75}
          >
            {googleLoading ? (
              <ActivityIndicator size="small" color={t.textMuted} />
            ) : (
              <Text style={{ fontSize: 17, fontWeight: '800', color: '#4285F4', lineHeight: 22 }}>
                G
              </Text>
            )}
            <Text style={{ color: t.text, fontWeight: '600', fontSize: 15 }}>
              Continuar con Google
            </Text>
          </TouchableOpacity>

          <Button
            title={mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
            variant="secondary"
            onPress={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
