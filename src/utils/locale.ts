/**
 * Idioma del dispositivo, sin dependencias nativas extra.
 *
 * Hermes incluye `Intl`, así que resolvemos el locale con
 * `Intl.DateTimeFormat().resolvedOptions().locale` (p. ej. "es-ES") y nos
 * quedamos con el código de 2 letras ("es"). Sirve para pedir a
 * OpenFoodFacts los textos (nombre, ingredientes) en el idioma del usuario.
 */

let cachedLang: string | null = null;

export function deviceLanguage(): string {
  if (cachedLang) return cachedLang;
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en';
    cachedLang = locale.split('-')[0].toLowerCase();
  } catch {
    cachedLang = 'en';
  }
  return cachedLang;
}

/**
 * Cadena de idiomas preferidos para buscar un texto localizado en OFF:
 * idioma del usuario primero, luego inglés y español como apoyos comunes.
 */
export function preferredLanguages(): string[] {
  const lang = deviceLanguage();
  const chain = [lang, 'en', 'es'];
  return [...new Set(chain)];
}
