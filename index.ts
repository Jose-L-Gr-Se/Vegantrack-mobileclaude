import { registerRootComponent } from 'expo';

import App from './App';
import { initErrorReporting } from '@/lib/errorReporting';

// Lo antes posible en el arranque, para capturar el mayor error fatal
// posible (ver src/lib/errorReporting.ts). No-op si no hay DSN configurado.
initErrorReporting();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
