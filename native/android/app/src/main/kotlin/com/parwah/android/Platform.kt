package com.parwah.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.parwah.core.Seat
import com.parwah.core.TokenStore
import com.parwah.core.Transport
import com.parwah.core.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The real network: HTTPS only, with timeouts a phone on mobile data can live with. */
class HttpTransport : Transport {
    override suspend fun send(method: String, url: String, headers: Map<String, String>, body: String?): Pair<Int, String> =
        withContext(Dispatchers.IO) {
            val c = URL(url).openConnection() as HttpURLConnection
            try {
                c.requestMethod = method
                c.connectTimeout = 15_000
                c.readTimeout = 30_000
                headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
                if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
                val code = c.responseCode
                val stream = if (code >= 400) c.errorStream else c.inputStream
                code to (stream?.bufferedReader()?.use { it.readText() } ?: "")
            } finally { c.disconnect() }
        }
}

/**
 * The session token, encrypted with an AES key that never leaves the
 * Android Keystore. A cloud backup or a copied file holds only ciphertext,
 * and the app excludes it from backup anyway (android:allowBackup="false").
 */
class KeystoreTokenStore(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("parwah-session", Context.MODE_PRIVATE)
    private val alias = "parwah-session-key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build())
        return gen.generateKey()
    }

    override var token: String?
        get() {
            val raw = prefs.getString("t", null) ?: return null
            return try {
                val all = Base64.decode(raw, Base64.NO_WRAP)
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, 12))
                String(c.doFinal(all, 12, all.size - 12))
            } catch (e: Exception) { null }
        }
        set(value) {
            if (value == null) { prefs.edit().remove("t").apply(); return }
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            prefs.edit().putString("t", Base64.encodeToString(c.iv + c.doFinal(value.toByteArray()), Base64.NO_WRAP)).apply()
        }
}

/** What is remembered between launches besides the token: who, and which family. Nothing secret. */
class Remembered(context: Context) {
    private val prefs = context.getSharedPreferences("parwah", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    var user: User?
        get() = prefs.getString("user", null)?.let { runCatching { json.decodeFromString<User>(it) }.getOrNull() }
        set(v) { prefs.edit().apply { if (v == null) remove("user") else putString("user", json.encodeToString(User.serializer(), v)) }.apply() }
    var seat: Seat?
        get() = prefs.getString("seat", null)?.let { runCatching { json.decodeFromString<Seat>(it) }.getOrNull() }
        set(v) { prefs.edit().apply { if (v == null) remove("seat") else putString("seat", json.encodeToString(Seat.serializer(), v)) }.apply() }
    var cc: String
        get() = prefs.getString("cc", "+91") ?: "+91"
        set(v) { prefs.edit().putString("cc", v).apply() }
    fun clear() = prefs.edit().clear().apply()
}
