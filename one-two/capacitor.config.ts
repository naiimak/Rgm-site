import type { CapacitorConfig } from '@capacitor/cli';

// Wraps the built app (dist/) as the iOS and Android apps. Set VITE_SERVER_URL to the game
// server's public address before `npm run build`, then `npx cap add ios` / `npx cap add android`.
const config: CapacitorConfig = {
  appId: 'com.onetwo.game',
  appName: 'One-Two',
  webDir: 'dist',
  backgroundColor: '#0b3d2e',
  ios: { contentInset: 'always' },
};

export default config;
