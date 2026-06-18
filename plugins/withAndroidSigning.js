/**
 * Expo config plugin: inyecta la configuración de firma de release en
 * android/app/build.gradle durante `expo prebuild`.
 *
 * Las credenciales llegan como variables de entorno (nunca hardcoded):
 *   VEGANTRACK_STORE_FILE     – ruta relativa al .keystore dentro de android/app/
 *   VEGANTRACK_STORE_PASSWORD – contraseña del keystore
 *   VEGANTRACK_KEY_ALIAS      – alias de la clave
 *   VEGANTRACK_KEY_PASSWORD   – contraseña de la clave
 *
 * Si alguna variable no está definida, el plugin no modifica nada
 * (el build de desarrollo/test sigue usando signingConfigs.debug).
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const withAndroidSigning = (config) => {
  return withAppBuildGradle(config, (mod) => {
    const storeFile = process.env.VEGANTRACK_STORE_FILE;
    const storePassword = process.env.VEGANTRACK_STORE_PASSWORD;
    const keyAlias = process.env.VEGANTRACK_KEY_ALIAS;
    const keyPassword = process.env.VEGANTRACK_KEY_PASSWORD;

    // Skip if any signing credential is missing (dev/test builds)
    if (!storeFile || !storePassword || !keyAlias || !keyPassword) {
      return mod;
    }

    let contents = mod.modResults.contents;

    // 1. Insert signingConfigs block before buildTypes (idempotent check)
    if (!contents.includes('signingConfigs {')) {
      const signingBlock = `
    signingConfigs {
        release {
            storeFile file("${storeFile}")
            storePassword "${storePassword}"
            keyAlias "${keyAlias}"
            keyPassword "${keyPassword}"
        }
    }
`;
      contents = contents.replace('    buildTypes {', `${signingBlock}\n    buildTypes {`);
    }

    // 2. Replace signingConfigs.debug with signingConfigs.release inside release buildType
    contents = contents.replace(
      /(\s+release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release'
    );

    mod.modResults.contents = contents;
    return mod;
  });
};

module.exports = withAndroidSigning;
