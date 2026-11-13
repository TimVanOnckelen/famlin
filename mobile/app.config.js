import { readFileSync } from 'fs'
import { withBaseMod } from 'expo/config-plugins'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getExpoMajorVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'node_modules/expo/package.json'), 'utf8'))
    return parseInt(pkg.version.split('.')[0], 10)
  } catch {
    return 0
  }
}

/**
 * Derive an integer Android versionCode from the marketing version and the
 * installed Expo SDK major version. This matches the scheme release-please's
 * Expo updater uses, so the versionCode always increases with each release
 * without having to maintain it by hand in app.json.
 */
function versionCodeFromVersion(version) {
  const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10))
  return getExpoMajorVersion() * 10000000 + major * 10000 + minor * 100 + patch
}

// Camera is used for story photos (expo-image-picker) and for scanning the
// server's "connect" QR code on the login screen (expo-camera, issue #345).
const CAMERA_PERMISSION =
  "Famlin uses your camera so you can take a photo to share as a story with your family, or scan the QR code your family server shows to connect the app to it. Photos are uploaded only to the family server you're signed in to; nothing the camera sees when scanning is saved."

// Opt-in development variant (issue #352): `APP_VARIANT=development` gives a
// local build its own bundle id / package, name and icon so it installs next
// to the store app instead of replacing it (and sharing its data). Only the
// local `npm run android:dev` / `ios:dev` scripts set it — EAS profiles never
// do, so every EAS/CI build stays the production app. The `famlin://` scheme
// is deliberately shared, see docs/developers/quick-start.md.
const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development'
const APP_ID = IS_DEV_VARIANT ? 'be.xeweb.famlin.dev' : 'be.xeweb.famlin'

// Local iOS signing overrides for contributors, never used by EAS/CI. Apple
// lets a bundle id belong to one developer team only, so a contributor can't
// sign be.xeweb.famlin(.dev) with their own account. They put these in
// mobile/.env.local (gitignored; Expo CLI loads it before evaluating this
// file), see docs/developers/quick-start.md:
//
// - FAMLIN_IOS_BUNDLE_ID: their own bundle id (the dev variant appends ".dev"),
//   which also moves the share extension's App Group to group.<id>.
// - FAMLIN_IOS_TEAM_ID: their Apple team id, so Xcode signs without edits.
// - FAMLIN_IOS_FREE_TEAM=1: for a free (personal team) Apple account, which
//   can't sign push notifications, Sign in with Apple or App Groups. Leaves
//   those three out of the iOS build (no push, no Apple login button, no
//   "Share → Famlin"); everything else works.
//
// When you add an iOS capability, check whether a free account can sign it,
// and add its entitlement to FREE_TEAM_UNSIGNABLE_ENTITLEMENTS below if not,
// or this build breaks again.
const IOS_BUNDLE_ID_OVERRIDE = process.env.FAMLIN_IOS_BUNDLE_ID?.trim() || undefined
const IOS_TEAM_ID = process.env.FAMLIN_IOS_TEAM_ID?.trim() || undefined
const IOS_FREE_TEAM = process.env.FAMLIN_IOS_FREE_TEAM === '1'

if (process.env.EAS_BUILD && (IOS_BUNDLE_ID_OVERRIDE || IOS_TEAM_ID || IOS_FREE_TEAM)) {
  // A store build without push, or under someone else's bundle id, must never
  // ship by accident.
  throw new Error('[app.config] FAMLIN_IOS_* are for local builds only and must not be set on EAS.')
}
if (IOS_BUNDLE_ID_OVERRIDE && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(IOS_BUNDLE_ID_OVERRIDE)) {
  throw new Error(
    `[app.config] FAMLIN_IOS_BUNDLE_ID "${IOS_BUNDLE_ID_OVERRIDE}" is not a valid bundle id (e.g. com.yourname.famlin).`
  )
}

const IOS_APP_ID = IOS_BUNDLE_ID_OVERRIDE
  ? IS_DEV_VARIANT
    ? `${IOS_BUNDLE_ID_OVERRIDE}.dev`
    : IOS_BUNDLE_ID_OVERRIDE
  : APP_ID

/**
 * Gradle's google-services plugin fails the build when the file has no client
 * for the app's package. Until be.xeweb.famlin.dev is registered in Firebase
 * (and the downloaded google-services.json carries both clients), the dev
 * variant is built without Firebase: everything works except push.
 */
function googleServicesFileFor(file) {
  if (!IS_DEV_VARIANT) return file
  try {
    const json = JSON.parse(readFileSync(join(__dirname, file), 'utf8'))
    const hasClient = (json.client ?? []).some((c) => c.client_info?.android_client_info?.package_name === APP_ID)
    if (hasClient) return file
  } catch {
    // Missing or unreadable file: same outcome as no matching client.
  }
  console.warn(
    `[app.config] ${file} has no Firebase client for ${APP_ID}; building the dev variant without push notifications.`
  )
  return undefined
}

// Strips every entitlement a free team can't sign from the app's final
// entitlements plist. Expo applies expo-apple-authentication's plugin whenever
// the package is installed (listed below or not), and entitlement mods run in
// reverse registration order, so leaving plugins out or stripping in a plain
// withEntitlementsPlist isn't reliable. This mod runs the rest of the chain
// first and strips afterwards, so it wins wherever it's registered.
const FREE_TEAM_UNSIGNABLE_ENTITLEMENTS = [
  'aps-environment',
  'com.apple.developer.applesignin',
  'com.apple.security.application-groups',
]
function withoutFreeTeamUnsignableEntitlements(config) {
  return withBaseMod(config, {
    platform: 'ios',
    mod: 'entitlements',
    isProvider: false,
    async action({ modRequest, ...rest }) {
      const results = await modRequest.nextMod({ ...rest, modRequest })
      for (const key of FREE_TEAM_UNSIGNABLE_ENTITLEMENTS) delete results.modResults[key]
      return results
    },
  })
}

export default ({ config }) => ({
  ...config,
  name: IS_DEV_VARIANT ? 'Famlin (dev)' : 'Famlin',
  slug: 'famlin',
  owner: 'thexeroxs-team',
  version: config.version,
  orientation: 'default',
  icon: IS_DEV_VARIANT ? './assets/icon-dev.png' : './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'famlin',
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: IOS_APP_ID,
    ...(IOS_TEAM_ID ? { appleTeamId: IOS_TEAM_ID } : {}),
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
        'Famlin saves photos to your library when you tap Save on a family photo — for example, keeping a picture a relative posted of your kids. Famlin only adds photos you explicitly choose to save.',
      NSLocationWhenInUseUsageDescription:
        'Famlin uses your location only when you tap the location button while writing a post or a trip check-in, so it can suggest the place to attach — for example, tagging a beach day with the town you are in. Your location is never tracked in the background.',
    },
  },
  android: {
    package: APP_ID,
    versionCode: versionCodeFromVersion(config.version),
    adaptiveIcon: {
      foregroundImage: IS_DEV_VARIANT ? './assets/adaptive-icon-dev.png' : './assets/adaptive-icon.png',
      // The dev colour is the brand teal hue-rotated to orange, matching
      // scripts/generate-dev-icons.py.
      backgroundColor: IS_DEV_VARIANT ? '#943b00' : '#006e94',
    },
    googleServicesFile: googleServicesFileFor(config.android?.googleServicesFile ?? './google-services.json'),
  },
  web: {
    favicon: './assets/favicon.png',
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID || '42c3e9a8-50e3-4f19-a670-e9cb2766f3c9',
    },
    // Read at runtime (src/utils/iosFreeTeam.ts) to skip push registration and
    // hide the Apple login button, both of which fail without the entitlement.
    iosFreeTeam: IOS_FREE_TEAM,
  },
  plugins: [
    '@react-native-community/datetimepicker',
    [
      'expo-build-properties',
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
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#edf7fb',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#006e94',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          "Famlin needs access to your photo library so you can pick the photos and videos you want to share with your family — for example, choosing a picture from your child's birthday to add to a new post, a comment, or a trip check-in. Photos you pick are uploaded only to the family server you are signed in to, and nothing else in your library is read.",
        cameraPermission: CAMERA_PERMISSION,
        // Story capture takes still photos and does not need microphone access.
        microphonePermission: false,
      },
    ],
    [
      'expo-camera',
      {
        // Same string as expo-image-picker's: both plugins write the one
        // NSCameraUsageDescription, so it has to describe both uses.
        cameraPermission: CAMERA_PERMISSION,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Famlin uses your location only when you tap the location button while writing a post or a trip check-in, so it can suggest the place to attach — for example, tagging a beach day with the town you are in. Your location is never tracked in the background.',
      },
    ],
    [
      'expo-media-library',
      {
        savePhotosPermission:
          'Famlin saves photos to your library when you tap Save on a family photo — for example, keeping a picture a relative posted of your kids. Famlin only adds photos you explicitly choose to save.',
        isAccessMediaLocationEnabled: false,
      },
    ],
    [
      // "Share → Famlin" from the OS share sheet (issue #199): photos and
      // videos only, several at once, handed to the new-post composer. On iOS
      // this adds a share extension target (<bundle id>.share-extension)
      // sharing the App Group group.<bundle id> with the app — both need
      // provisioning on EAS, see docs/developers/ios-app-review.md.
      // The extension only hands the files to the app; it never sees the
      // auth token. iOS caps the count above the composer's 10 on purpose:
      // more are accepted and the composer reports the skipped ones.
      'expo-share-intent',
      {
        iosActivationRules: {
          NSExtensionActivationSupportsImageWithMaxCount: 50,
          NSExtensionActivationSupportsMovieWithMaxCount: 50,
        },
        // Shown under the icon in the iOS share sheet, and (stripped of
        // spaces) the Xcode target name — plain "Famlin" would collide with
        // the app's own target.
        iosShareExtensionName: 'Famlin Share',
        androidIntentFilters: ['image/*', 'video/*'],
        androidMultiIntentFilters: ['image/*', 'video/*'],
        // A free team can't sign the share extension or its App Group.
        disableIOS: IOS_FREE_TEAM,
      },
    ],
    'expo-apple-authentication',
    'expo-font',
    'expo-localization',
    'expo-secure-store',
    'expo-web-browser',
    'expo-sharing',
    'expo-video',
    'expo-status-bar',
    'expo-image',
    IOS_FREE_TEAM ? withoutFreeTeamUnsignableEntitlements : undefined,
  ].filter(Boolean),
})
