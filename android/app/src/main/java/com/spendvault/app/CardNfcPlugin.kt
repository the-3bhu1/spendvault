package com.spendvault.app

import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Tap-to-add for the card form: reads a contactless card's number, expiry and network.
 *
 * Uses reader mode, held only while the JS "Tap card" sheet is open. No manifest intent-filters,
 * so a card tapped while the app is closed (or on any other screen) does nothing, and
 * android.permission.NFC is a normal permission — no runtime prompt.
 *
 * Results go out as events rather than as the startScan() return value, because a read can fail
 * and be retried (card pulled away too soon) without the sheet closing.
 *
 * Never log the card number.
 */
@CapacitorPlugin(name = "CardNfc")
class CardNfcPlugin : Plugin() {

    // What JS asked for, independent of whether reader mode is live right now: reader mode is
    // dropped on pause (Android requires a resumed activity) and has to come back on resume.
    @Volatile private var scanning = false

    private val adapter: NfcAdapter? get() = NfcAdapter.getDefaultAdapter(context)

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val a = adapter
        val ret = JSObject()
        ret.put("supported", a != null)
        ret.put("enabled", a?.isEnabled == true)
        call.resolve(ret)
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        val a = adapter
        if (a == null) { call.reject("NFC not supported", "UNSUPPORTED"); return }
        if (!a.isEnabled) { call.reject("NFC is turned off", "DISABLED"); return }
        scanning = true
        enableReader()
        call.resolve()
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        scanning = false
        disableReader()
        call.resolve()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        if (scanning) enableReader()
    }

    override fun handleOnPause() {
        disableReader()
        super.handleOnPause()
    }

    override fun handleOnDestroy() {
        scanning = false
        disableReader()
        super.handleOnDestroy()
    }

    private fun enableReader() {
        val activity = bridge?.activity ?: return
        activity.runOnUiThread {
            adapter?.enableReaderMode(
                activity,
                { tag -> onTag(tag) },
                NfcAdapter.FLAG_READER_NFC_A or
                    NfcAdapter.FLAG_READER_NFC_B or
                    NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or
                    NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
                null
            )
        }
    }

    private fun disableReader() {
        val activity = bridge?.activity ?: return
        activity.runOnUiThread {
            try { adapter?.disableReaderMode(activity) } catch (_: Exception) { /* activity already gone */ }
        }
    }

    // Runs on the NFC binder thread, so the blocking transceive calls are fine here.
    private fun onTag(tag: Tag) {
        if (!scanning) return
        val iso = IsoDep.get(tag)
        if (iso == null) { emitError("NOT_EMV", "Not a payment card"); return }
        try {
            iso.connect()
            iso.timeout = 5000
            val r = EmvReader { apdu -> iso.transceive(apdu) }.read()
            val ret = JSObject()
            ret.put("cardNumber", r.pan)
            r.expiryMonth?.let { ret.put("expiryMonth", it) }
            r.expiryYear?.let { ret.put("expiryYear", it) }
            r.network?.let { ret.put("network", it) }
            r.label?.let { ret.put("label", it) }
            notifyListeners("cardRead", ret)
        } catch (e: EmvReader.EmvException) {
            emitError(e.code, e.message ?: "Couldn't read card")
        } catch (e: java.io.IOException) { // includes TagLostException
            emitError("TAG_LOST", "Card moved away too soon")
        } catch (e: Exception) {
            android.util.Log.w("SpendVaultNfc", "Card read failed: ${e.javaClass.simpleName}")
            emitError("READ_FAILED", "Couldn't read card")
        } finally {
            try { iso.close() } catch (_: Exception) {}
        }
    }

    private fun emitError(code: String, message: String) {
        val ret = JSObject()
        ret.put("code", code)
        ret.put("message", message)
        notifyListeners("cardError", ret)
    }
}
