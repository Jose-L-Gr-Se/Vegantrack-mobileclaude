/**
 * Recuperación de contraseña en dos pasos, 100% dentro de la app (sin salir a
 * la web ni depender de deep links):
 *   1. el usuario introduce su email y recibe un código de 6 dígitos,
 *   2. introduce el código + la nueva contraseña y queda con sesión iniciada.
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { radii, semantic, spacing, useTheme } from '@/theme';
import { useAuthStore } from '@/stores/authStore';

export function ForgotPasswordSheet({
  initialEmail,
  onClose,
  onDone,
}: {
  initialEmail?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useTheme();
  const { sendPasswordReset, confirmPasswordReset } = useAuthStore();
  const [phase, setPhase] = useState<'request' | 'confirm'>('request');
  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!email.trim()) {
      setError('Introduce tu email');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await sendPasswordReset(email.trim());
    setLoading(false);
    if (error) setError(error);
    else setPhase('confirm');
  };

  const confirm = async () => {
    if (code.trim().length < 6) {
      setError('Introduce el código de 6 dígitos que te hemos enviado');
      return;
    }
    if (password.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await confirmPasswordReset(email.trim(), code.trim(), password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    onDone?.();
    onClose();
  };

  return (
    <BottomSheet visible onClose={onClose}>
      <View style={{ gap: spacing.lg, paddingTop: spacing.sm }}>
        <View style={{ alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: t.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={'lock-closed-outline' as never} size={26} color={t.primary} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: t.text }}>
            Recuperar contraseña
          </Text>
          <Text style={{ color: t.textSecondary, fontSize: 13, textAlign: 'center' }}>
            {phase === 'request'
              ? 'Te enviaremos un código de 6 dígitos a tu correo.'
              : `Escribe el código que enviamos a ${email} y tu nueva contraseña.`}
          </Text>
        </View>

        {phase === 'request' ? (
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="tu@email.com"
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            <Input
              label="Código de 6 dígitos"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="123456"
            />
            <View style={{ gap: 6 }}>
              <Input
                label="Nueva contraseña"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={6}>
                <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>
                  {showPassword ? 'Ocultar' : 'Mostrar'} contraseña
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {error ? (
          <View
            style={{
              backgroundColor: t.dark ? 'rgba(239,68,68,0.12)' : '#fef2f2',
              borderRadius: radii.md,
              padding: spacing.md,
              borderLeftWidth: 3,
              borderLeftColor: semantic.danger,
            }}
          >
            <Text style={{ color: t.dark ? '#fca5a5' : '#dc2626', fontSize: 13 }}>{error}</Text>
          </View>
        ) : null}

        {phase === 'request' ? (
          <Button title="Enviar código" onPress={sendCode} loading={loading} />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Button title="Cambiar contraseña" onPress={confirm} loading={loading} />
            <Pressable onPress={() => { setPhase('request'); setError(null); }} hitSlop={6} style={{ alignItems: 'center', paddingVertical: spacing.xs }}>
              <Text style={{ color: t.textMuted, fontSize: 13, fontWeight: '600' }}>
                No me ha llegado — reenviar código
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
