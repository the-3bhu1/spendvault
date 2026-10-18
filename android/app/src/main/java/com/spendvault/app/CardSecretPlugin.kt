package com.spendvault.app

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts card CVVs before they reach localStorage (src/services/cardSecrets.ts).
 *
 * AES-256-GCM under a key generated inside the Android Keystore: it never leaves the device's secure
 * hardware, can't be exported, and isn't part of Android's Auto Backup. So a CVV restored onto another
 * phone — from a Google backup of the WebView's storage — is ciphertext nothing can open, which is
 * what "CVVs stay on this phone" means.
 *
 * Ciphertext is base64(12-byte IV ‖ GCM output). Never log either side.
 */
@CapacitorPlugin(name = "CardSecret")
class CardSecretPlugin : Plugin() {

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    @PluginMethod
    fun encrypt(call: PluginCall) {
        val plaintext = call.getString("plaintext") ?: return call.reject("plaintext is required")
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val sealed = cipher.iv + cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
            call.resolve(JSObject().put("ciphertext", Base64.encodeToString(sealed, Base64.NO_WRAP)))
        } catch (e: Exception) {
            call.reject("encrypt failed", e)
        }
    }

    @PluginMethod
    fun decrypt(call: PluginCall) {
        val ciphertext = call.getString("ciphertext") ?: return call.reject("ciphertext is required")
        try {
            val sealed = Base64.decode(ciphertext, Base64.NO_WRAP)
            if (sealed.size <= IV_BYTES) return call.reject("ciphertext too short")
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
            val plain = cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
            call.resolve(JSObject().put("plaintext", String(plain, Charsets.UTF_8)))
        } catch (e: Exception) {
            // A different device's key (restored backup) or a wiped Keystore: unrecoverable.
            call.reject("decrypt failed", "UNREADABLE")
        }
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "spendvault_card_secrets"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
    }
}
