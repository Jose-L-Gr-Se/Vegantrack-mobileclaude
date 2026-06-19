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
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Input } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { brand, fonts, radii, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

WebBrowser.maybeCompleteAuthSession();

export function AuthScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
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
      setError(t('auth.error_empty'));
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

  const heroBg = theme.dark ? brand[800] : brand[600];

  const FEATURES = [
    { icon: '📱', label: t('auth.chip_offline') },
    { icon: '🌱', label: t('auth.chip_plants') },
    { icon: '🔒', label: t('auth.chip_private') },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
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
            {t('auth.subtitle')}
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
                flexDirection: 'row', backgroundColor: theme.background,
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
                    backgroundColor: mode === m ? theme.card : 'transparent',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: mode === m && !theme.dark ? 0.08 : 0,
                    shadowRadius: 2,
                    elevation: mode === m ? 1 : 0,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '700', fontSize: 14,
                      color: mode === m ? theme.primary : theme.textMuted,
                    }}
                  >
                    {m === 'login' ? t('auth.login') : t('auth.register')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label={t('auth.email_label')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder={t('auth.email_placeholder')}
            />
            <Input
              label={t('auth.password_label')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder={t('auth.password_placeholder')}
            />

            {error ? (
              <View
                style={{
                  backgroundColor: theme.dark ? 'rgba(239,68,68,0.12)' : '#fef2f2',
                  borderRadius: radii.md,
                  padding: spacing.md,
                  borderLeftWidth: 3,
                  borderLeftColor: '#ef4444',
                }}
              >
                <Text style={{ color: theme.dark ? '#fca5a5' : '#dc2626', fontSize: 13 }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <Button
              title={mode === 'login' ? t('auth.login') : t('auth.register')}
              onPress={submit}
              loading={loading}
            />

            {/* Divider */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.separator }} />
              <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>
                {t('auth.divider')}
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.separator }} />
            </View>

            {/* Google button */}
            <TouchableOpacity
              onPress={handleGoogle}
              disabled={googleLoading || loading}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: spacing.sm, height: 50, borderRadius: radii.lg,
                borderWidth: 1, borderColor: theme.cardBorder, backgroundColor: theme.inputBg,
                opacity: googleLoading ? 0.6 : 1,
              }}
            >
              {googleLoading ? (
                <ActivityIndicator size="small" color={theme.textMuted} />
              ) : (
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#4285F4', lineHeight: 22 }}>
                  G
                </Text>
              )}
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>
                {t('auth.google')}
              </Text>
            </TouchableOpacity>

          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
