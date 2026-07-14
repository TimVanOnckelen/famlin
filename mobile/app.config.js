export default ({ config }) => ({
  ...config,
  name: "Famlin",
  slug: "famlin",
  version: config.version,
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  scheme: "famlin",
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "be.xeweb.famlin",
    buildNumber: config.ios?.buildNumber,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "be.xeweb.famlin",
    versionCode: config.android?.versionCode,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#006e94",
    },
    googleServicesFile:
      config.android?.googleServicesFile ?? "./google-services.json",
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  extra: {
    eas: {
      projectId:
        process.env.EAS_PROJECT_ID || "42c3e9a8-50e3-4f19-a670-e9cb2766f3c9",
    },
  },
  plugins: [
    [
      "expo-splash-screen",
      {
        image: "./assets/splash.png",
        resizeMode: "contain",
        backgroundColor: "#edf7fb",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#006e94",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Famlin gebruikt je locatie om aan te geven waar een bericht is gemaakt.",
      },
    ],
    [
      "expo-media-library",
      {
        savePhotosPermission: "Allow Famlin to save photos to your library.",
        isAccessMediaLocationEnabled: false,
      },
    ],
    "expo-font",
    "expo-localization",
    "expo-secure-store",
    "expo-web-browser",
    "expo-video",
    "expo-status-bar",
  ],
});
