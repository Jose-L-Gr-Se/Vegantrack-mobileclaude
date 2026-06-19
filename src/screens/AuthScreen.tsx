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
import { Logo } from '@/components/Logo';
import { brand, fonts, radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

WebBrowser.maybeCompleteAuthSession();

const FEATURES = [
  { icon: '📱', label: 'Offline-first' },
  { icon: '🌱', label: '100% vegano' },
  { icon: '🔒', label: 'Privado' },
];

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

  const heroBg = t.dark ? brand[800] : brand[600];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* ── Hero ─────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: heroBg,
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: spacing.xxl + 24,
            paddingHorizontal: spacing.xl,
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          {/* Decorative background circles */}
          <View
            style={{
              position: 'absolute', top: -50, right: -50,
              width: 200, height: 200, borderRadius: 100,
              backgroundColor: 'rgba(255,255,255,0.08)',
            }}
          />
          <View
            style={{
              position: 'absolute', bottom: -30, left: -30,
              width: 140, height: 140, borderRadius: 70,
              backgroundColor: 'rgba(255,255,255,0.06)',
            }}
          />

          <Logo size={72} color="#f3efe3" dotColor="#2f5d41" />
          <Text
            style={{
              fontFamily: fonts.display, fontSize: 40, fontWeight: '400', color: '#fff',
              letterSpacing: -0.5, marginTop: spacing.sm,
            }}
          >
            Vegetrack
          </Text>
          <Text
            style={{
              color: 'rgba(255,255,255,0.75)', fontSize: 15,
              marginTop: spacing.xs, textAlign: 'center',
            }}
          >
            Nutrición vegana consciente
          </Text>

          {/* Feature chips */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            {FEATURES.map(({ icon, label }) => (
              <View
                key={label}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  paddingHorizontal: spacing.md, paddingVertical: 5,
                  borderRadius: radii.pill,
                }}
              >
                <Text style={{ fontSize: 12 }}>{icon}</Text>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Form card (overlaps hero slightly) ─────── */}
        <View style={{ marginTop: -20, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
          <Card style={{ gap: spacing.lg }}>

            {/* Login / Register pill toggle */}
            <View
              style={{
                flexDirection: 'row', backgroundColor: t.background,
                borderRadius: radii.pill, padding: 3,
              }}
            >
              {(['login', 'register'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => { setMode(m); setError(null); }}
                  activeOpacity={0.8}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 9,
                    borderRadius: radii.pill,
                    backgroundColor: mode === m ? t.card : 'transparent',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: mode === m && !t.dark ? 0.08 : 0,
                    shadowRadius: 2,
                    elevation: mode === m ? 1 : 0,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '700', fontSize: 14,
                      color: mode === m ? t.primary : t.textMuted,
                    }}
                  >
                    {m === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

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

            {error ? (
              <View
                style={{
                  backgroundColor: t.dark ? 'rgba(239,68,68,0.12)' : '#fef2f2',
                  borderRadius: radii.md,
                  padding: spacing.md,
                  borderLeftWidth: 3,
                  borderLeftColor: '#ef4444',
                }}
              >
                <Text style={{ color: t.dark ? '#fca5a5' : '#dc2626', fontSize: 13 }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <Button
              title={mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
              onPress={submit}
              loading={loading}
            />

            {/* Divider */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1, height: 1, backgroundColor: t.separator }} />
              <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>
                o continúa con
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: t.separator }} />
            </View>

            {/* Google button */}
            <TouchableOpacity
              onPress={handleGoogle}
              disabled={googleLoading || loading}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: spacing.sm, height: 50, borderRadius: radii.lg,
                borderWidth: 1, borderColor: t.cardBorder, backgroundColor: t.inputBg,
                opacity: googleLoading ? 0.6 : 1,
              }}
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

          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
