import ExpoModulesCore
import Security

// Generic-password items marked kSecAttrSynchronizable travel through iCloud
// Keychain (end-to-end encrypted by Apple) to the user's other devices, if
// iCloud Keychain is on. They live in the app's default keychain access group,
// which needs no extra entitlement (so a free personal team can sign it too).
// Nothing here can tell whether iCloud Keychain is actually enabled.
//
// kSecAttrAccessibleAfterFirstUnlock is deliberate: a *ThisDeviceOnly class
// would stop the item from syncing.
public final class FamlinKeySyncModule: Module {
  private var service: String {
    "\(Bundle.main.bundleIdentifier ?? "app.famlin").e2e-key-sync"
  }

  private func baseQuery(_ key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      // Must be part of every query, update and delete or the synced item isn't matched.
      kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
    ]
  }

  public func definition() -> ModuleDefinition {
    Name("FamlinKeySync")

    AsyncFunction("isAvailable") { () -> [String: Any] in
      return ["available": true, "endToEndEncrypted": NSNull()]
    }

    AsyncFunction("getItem") { (key: String) -> String? in
      var query = self.baseQuery(key)
      query[kSecReturnData as String] = kCFBooleanTrue
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: AnyObject?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound { return nil }
      guard status == errSecSuccess, let data = result as? Data else {
        throw Exception(name: "KeySyncError", description: "Keychain read failed (\(status))")
      }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("setItem") { (key: String, value: String) in
      let data = Data(value.utf8)
      let update = [kSecValueData as String: data] as CFDictionary
      var status = SecItemUpdate(self.baseQuery(key) as CFDictionary, update)
      if status == errSecItemNotFound {
        var add = self.baseQuery(key)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        status = SecItemAdd(add as CFDictionary, nil)
      }
      guard status == errSecSuccess else {
        throw Exception(name: "KeySyncError", description: "Keychain write failed (\(status))")
      }
    }

    AsyncFunction("deleteItem") { (key: String) in
      let status = SecItemDelete(self.baseQuery(key) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else {
        throw Exception(name: "KeySyncError", description: "Keychain delete failed (\(status))")
      }
    }
  }
}
