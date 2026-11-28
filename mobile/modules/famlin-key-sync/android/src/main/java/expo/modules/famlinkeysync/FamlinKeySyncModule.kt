package expo.modules.famlinkeysync

import com.google.android.gms.auth.blockstore.Blockstore
import com.google.android.gms.auth.blockstore.DeleteBytesRequest
import com.google.android.gms.auth.blockstore.RetrieveBytesRequest
import com.google.android.gms.auth.blockstore.StoreBytesData
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Google Block Store: limits are 16 entries of at most 1024 bytes each (enforced in
// the JS wrapper). Any Play services failure resolves as "unavailable" or a
// missing item, never a crash.
class FamlinKeySyncModule : Module() {
  private val client
    get() = Blockstore.getClient(appContext.reactContext ?: throw Exceptions.ReactContextLost())

  override fun definition() = ModuleDefinition {
    Name("FamlinKeySync")

    AsyncFunction("isAvailable") { promise: Promise ->
      try {
        client.isEndToEndEncryptionAvailable
          .addOnSuccessListener { encrypted ->
            promise.resolve(mapOf("available" to true, "endToEndEncrypted" to encrypted))
          }
          .addOnFailureListener {
            promise.resolve(mapOf("available" to false, "endToEndEncrypted" to null))
          }
      } catch (e: Exception) {
        promise.resolve(mapOf("available" to false, "endToEndEncrypted" to null))
      }
    }

    AsyncFunction("getItem") { key: String, promise: Promise ->
      try {
        client
          .retrieveBytes(RetrieveBytesRequest.Builder().setKeys(listOf(key)).build())
          .addOnSuccessListener { response ->
            val bytes = response.blockstoreDataMap[key]?.bytes
            promise.resolve(bytes?.toString(Charsets.UTF_8))
          }
          .addOnFailureListener { promise.resolve(null) }
      } catch (e: Exception) {
        promise.resolve(null)
      }
    }

    AsyncFunction("setItem") { key: String, value: String, promise: Promise ->
      try {
        val data = StoreBytesData.Builder()
          .setKey(key)
          .setBytes(value.toByteArray(Charsets.UTF_8))
          .setShouldBackupToCloud(true)
          .build()
        client.storeBytes(data)
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { promise.reject("KeySyncError", "Block Store write failed", it) }
      } catch (e: Exception) {
        promise.reject("KeySyncError", "Block Store write failed", e)
      }
    }

    AsyncFunction("deleteItem") { key: String, promise: Promise ->
      try {
        client
          .deleteBytes(DeleteBytesRequest.Builder().setKeys(listOf(key)).setDeleteAll(false).build())
          .addOnSuccessListener { promise.resolve(null) }
          .addOnFailureListener { promise.reject("KeySyncError", "Block Store delete failed", it) }
      } catch (e: Exception) {
        promise.reject("KeySyncError", "Block Store delete failed", e)
      }
    }
  }
}
