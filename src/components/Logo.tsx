/**
 * Marca de VeganTrack: círculo verde bosque con punto crema desplazado.
 * Vectorial (react-native-svg) para escalar nítido en cualquier tamaño.
 * Sustituye al emoji 🌱 en splash, auth y onboarding.
 */
import React from 'react';
import Svg, { Circle } from 'react-native-svg';
import { brand, semantic } from '@/theme';

export function Logo({
  size = 40,
  color = brand[600],
  dotColor = semantic.cream,
}: {
  size?: number;
  color?: string;
  dotColor?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={50} fill={color} />
      <Circle cx={66} cy={36} r={15} fill={dotColor} />
    </Svg>
  );
}

/** Marca + wordmark horizontal, para cabeceras. */
export function LogoMark({
  size = 28,
  color = brand[600],
  dotColor = semantic.cream,
}: {
  size?: number;
  color?: string;
  dotColor?: string;
}) {
  return <Logo size={size} color={color} dotColor={dotColor} />;
}
