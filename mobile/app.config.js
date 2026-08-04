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
    // Adds the Sign in with Apple entitlement — required alongside the
    // expo-apple-authentication plugin below for the login option App Store
    // guideline 4.8 requires next to the app's SSO login.
    usesAppleSignIn: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // Purpose strings are reviewed against guideline 5.1.1(ii): each has to
      // say what the data is used for and give a concrete example, not just
      // name the resource. Keep them specific if you edit them.
      NSPhotoLibraryUsageDescription:
        "Famlin needs access to your photo library so you can pick the photos and videos you want to share with your family — for example, choosing a picture from your child's birthday to add to a new post, a comment, or a trip check-in. Photos you pick are uploaded only to the family server you are signed in to, and nothing else in your library is read.",
      NSPhotoLibraryAddUsageDescription:
        "Famlin saves photos to your library when you tap Save on a family photo — for example, keeping a picture a relative posted of your kids. Famlin only adds photos you explicitly choose to save.",
      NSLocationWhenInUseUsageDescription:
        "Famlin uses your location only when you tap the location button while writing a post or a trip check-in, so it can suggest the place to attach — for example, tagging a beach day with the town you are in. Your location is never tracked in the background.",
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
          // R8 minification — expo-build-properties' key is
          // enableMinifyInReleaseBuilds (there is no
          // enableProguardInReleaseBuilds option; an unknown key is
          // silently ignored at prebuild).
          enableMinifyInReleaseBuilds: true,
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
      "expo-image-picker",
      {
        photosPermission:
          "Famlin needs access to your photo library so you can pick the photos and videos you want to share with your family — for example, choosing a picture from your child's birthday to add to a new post, a comment, or a trip check-in. Photos you pick are uploaded only to the family server you are signed in to, and nothing else in your library is read.",
        // Famlin only ever opens the library picker, never the camera or the
        // microphone. `false` deletes those purpose strings (and blocks the
        // Android permissions) instead of shipping the plugin's vague
        // defaults for capabilities the app doesn't use — an unused, generic
        // purpose string is exactly what guideline 5.1.1(ii) rejects.
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Famlin uses your location only when you tap the location button while writing a post or a trip check-in, so it can suggest the place to attach — for example, tagging a beach day with the town you are in. Your location is never tracked in the background.",
      },
    ],
    [
      "expo-media-library",
      {
        savePhotosPermission:
          "Famlin saves photos to your library when you tap Save on a family photo — for example, keeping a picture a relative posted of your kids. Famlin only adds photos you explicitly choose to save.",
        isAccessMediaLocationEnabled: false,
      },
    ],
    "expo-apple-authentication",
    "expo-font",
    "expo-localization",
    "expo-secure-store",
    "expo-web-browser",
    "expo-video",
    "expo-status-bar",
    "expo-image",
  ],
});
