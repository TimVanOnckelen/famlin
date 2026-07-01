export default ({ config }) => ({
  ...config,
  name: 'Famlin',
  slug: 'famlin',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#FDF8F3',
  },
  scheme: 'famlin',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'be.xeweb.famlin',
    buildNumber: '0.1.0',
  },
  android: {
    package: 'be.xeweb.famlin',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FDF8F3',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID || 'your-eas-project-id',
    },
    googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '',
  },
  plugins: [
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#D96A5E',
      },
    ],
  ],
});
