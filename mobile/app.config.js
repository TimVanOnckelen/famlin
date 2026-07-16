import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getExpoMajorVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "node_modules/expo/package.json"), "utf8")
    );
    return parseInt(pkg.version.split(".")[0], 10);
  } catch {
    return 0;
  }
}

/**
 * Derive an integer Android versionCode from the marketing version and the
 * installed Expo SDK major version. This matches the scheme release-please's
 * Expo updater uses, so the versionCode always increases with each release
 * without having to maintain it by hand in app.json.
 */
function versionCodeFromVersion(version) {
  const [major, minor, patch] = version.split(".").map((n) => parseInt(n, 10));
  return getExpoMajorVersion() * 10000000 + major * 10000 + minor * 100 + patch;
}

export default ({ config }) => ({
  ...config,
  name: "Famlin",
  slug: "famlin",
  owner: "thexeroxs-team",
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
    versionCode: versionCodeFromVersion(config.version),
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
      "expo-build-properties",
      {
        android: {
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
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
