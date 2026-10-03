package com.spendvault.app

import java.io.ByteArrayOutputStream
import java.util.Calendar
import java.util.Locale
import kotlin.random.Random

/**
 * Reads the printed-face fields of a contactless EMV card: number, expiry, network.
 *
 * This is the same unauthenticated read any payment terminal does before it asks the card for a
 * cryptogram — SELECT PPSE → SELECT AID → GET PROCESSING OPTIONS → READ RECORD — and it stops
 * there. Nothing here can charge the card, and nothing leaves the phone.
 *
 * What it can NOT get, by design of the cards themselves: the CVV (not on the chip at all) and,
 * on most modern cards, the cardholder name (blanked for privacy). The issuing bank isn't on the
 * chip either. The user types those.
 *
 * Pure logic: the NFC link is passed in as [transceive], so the whole sequence runs under plain
 * JUnit with canned responses.
 */
class EmvReader(private val transceive: (ByteArray) -> ByteArray) {

    data class Result(
        val pan: String,
        val expiryMonth: Int?,
        val expiryYear: Int?, // 2-digit, matching CardDetails.expiryYear
        val network: String?, // a CardNetwork id, or null when the AID is one we don't map
        val label: String?,   // the card's own application label, e.g. "VISA DEBIT"
    )

    /** Why a read failed, as the code the JS side switches on. */
    class EmvException(val code: String, message: String) : Exception(message)

    fun read(): Result {
        val aids = selectPpse().ifEmpty { KNOWN_AIDS }
        for (aid in aids) {
            val fci = select(aid) ?: continue
            val label = Tlv.find(fci, 0x50)?.let { String(it, Charsets.US_ASCII).trim() }?.takeIf { it.isNotEmpty() }
            val found = readApplication(fci)
            val pan = found.pan ?: continue
            if (!luhnValid(pan)) throw EmvException("READ_FAILED", "Card number failed checksum")
            return Result(
                pan = pan,
                expiryMonth = found.expiryMonth,
                expiryYear = found.expiryYear,
                network = networkForAid(aid) ?: networkForPan(pan),
                label = label,
            )
        }
        throw EmvException("NOT_EMV", "No payment application answered")
    }

    // ── Steps ───────────────────────────────────────────────────────────────────────────────

    /** The contactless directory. Lists the card's payment apps, best first. Empty if absent. */
    private fun selectPpse(): List<ByteArray> {
        val fci = select("2PAY.SYS.DDF01".toByteArray(Charsets.US_ASCII)) ?: return emptyList()
        return Tlv.findAll(fci, 0x61)
            .mapNotNull { entry ->
                val aid = Tlv.find(entry, 0x4F) ?: return@mapNotNull null
                val priority = Tlv.find(entry, 0x87)?.firstOrNull()?.toInt()?.and(0x0F) ?: 0
                aid to priority
            }
            .sortedBy { it.second }
            .map { it.first }
    }

    private fun select(name: ByteArray): ByteArray? =
        send(byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, name.size.toByte()) + name + 0x00)

    private class Found(var pan: String? = null, var expiryMonth: Int? = null, var expiryYear: Int? = null) {
        fun absorb(data: ByteArray) {
            // Tag 5A (PAN) and 5F24 (expiry) are the clean source. Track-2 equivalent data — 57,
            // or 9F6B on Mastercard's magstripe mode — carries both too, and is all some cards send.
            if (pan == null) Tlv.find(data, 0x5A)?.let { pan = bcd(it) }
            if (expiryMonth == null) Tlv.find(data, 0x5F24)?.let { parseYymm(bcd(it)) }
            val track2 = Tlv.find(data, 0x57) ?: Tlv.find(data, 0x9F6B) ?: return
            val digits = bcd(track2)
            val sep = digits.indexOfFirst { it == 'D' || it == '=' }
            if (sep <= 0) return
            if (pan == null) pan = digits.substring(0, sep)
            if (expiryMonth == null && digits.length >= sep + 5) parseYymm(digits.substring(sep + 1, sep + 5))
        }

        private fun parseYymm(s: String) {
            val yy = s.take(2).toIntOrNull() ?: return
            val mm = s.drop(2).take(2).toIntOrNull() ?: return
            if (mm !in 1..12) return
            expiryYear = yy
            expiryMonth = mm
        }

        val done get() = pan != null && expiryMonth != null
    }

    private fun readApplication(fci: ByteArray): Found {
        val found = Found()
        val pdol = Tlv.find(fci, 0x9F38)
        val gpoBody = byteArrayOf(0x83.toByte()) + encodeLength(pdolData(pdol))
        val gpo = send(byteArrayOf(0x80.toByte(), 0xA8.toByte(), 0x00, 0x00, gpoBody.size.toByte()) + gpoBody + 0x00)

        if (gpo != null) {
            // Visa's qVSDC often hands track-2 straight back in the GPO response.
            found.absorb(gpo)
            if (found.done) return found
            for (entry in aflEntries(gpo)) {
                for (rec in entry.first..entry.second) {
                    readRecord(entry.third, rec)?.let { found.absorb(it) }
                    if (found.done) return found
                }
            }
        }

        // A card that refused our GPO (an odd PDOL, a terminal profile it didn't like) will still
        // often answer READ RECORD for the usual files. Cheap to try before giving up.
        for (sfi in 1..3) {
            for (rec in 1..5) {
                readRecord(sfi, rec)?.let { found.absorb(it) }
                if (found.done) return found
            }
        }
        return found
    }

    private fun readRecord(sfi: Int, record: Int): ByteArray? =
        send(byteArrayOf(0x00, 0xB2.toByte(), record.toByte(), ((sfi shl 3) or 0x04).toByte(), 0x00))

    /** (first record, last record, SFI) for each 4-byte AFL entry. */
    private fun aflEntries(gpo: ByteArray): List<Triple<Int, Int, Int>> {
        val afl = Tlv.find(gpo, 0x94)
            // Format 1 (tag 80): 2 bytes of AIP, then the AFL raw.
            ?: Tlv.find(gpo, 0x80)?.let { it.copyOfRange(minOf(2, it.size), it.size) }
            ?: return emptyList()
        return (0 until afl.size / 4).map { i ->
            val o = i * 4
            Triple(afl[o + 1].toInt() and 0xFF, afl[o + 2].toInt() and 0xFF, (afl[o].toInt() and 0xFF) shr 3)
        }.filter { it.third in 1..30 && it.first in 1..it.second }
    }

    /** Fills the card's PDOL with what a plain Indian contactless terminal would send. */
    private fun pdolData(pdol: ByteArray?): ByteArray {
        if (pdol == null) return ByteArray(0)
        val out = ByteArrayOutputStream()
        var i = 0
        while (i < pdol.size) {
            val (tag, tagLen) = Tlv.readTag(pdol, i)
            i += tagLen
            if (i >= pdol.size) break
            val len = pdol[i].toInt() and 0xFF
            i += 1
            val value = terminalValue(tag)
            out.write(ByteArray(len) { j -> if (value != null && j < value.size) value[j] else 0 })
        }
        return out.toByteArray()
    }

    private fun terminalValue(tag: Int): ByteArray? = when (tag) {
        // Terminal Transaction Qualifiers: qVSDC + contact EMV + online PIN + signature, CDCVM ok.
        0x9F66 -> byteArrayOf(0x36, 0x00, 0x40, 0x00)
        0x9F1A, 0x5F2A -> byteArrayOf(0x03, 0x56) // India, INR
        0x9F02 -> byteArrayOf(0, 0, 0, 0, 0, 0x01) // amount: 0.01, never charged
        0x9A -> Calendar.getInstance().let { c -> // java.time needs API 26; minSdk is 23
            hex("%02d%02d%02d".format(Locale.US, c.get(Calendar.YEAR) % 100, c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH)))
        }
        0x9C -> byteArrayOf(0x00) // purchase
        0x9F37 -> Random.nextBytes(4) // unpredictable number
        0x9F35 -> byteArrayOf(0x22) // attended, online-capable merchant terminal
        0x9F33 -> byteArrayOf(0xE0.toByte(), 0xF0.toByte(), 0xC8.toByte())
        else -> null
    }

    /**
     * One APDU round trip. Returns the payload on 9000, null on any other status. Follows the two
     * ISO 7816 "ask me again" statuses so callers never see them.
     */
    private fun send(apdu: ByteArray): ByteArray? {
        var resp = transceive(apdu)
        if (resp.size < 2) return null
        var sw1 = resp[resp.size - 2].toInt() and 0xFF
        var sw2 = resp[resp.size - 1]
        if (sw1 == 0x6C) { // wrong Le: resend with the length the card asked for
            resp = transceive(apdu.copyOf(apdu.size - 1) + sw2)
            if (resp.size < 2) return null
            sw1 = resp[resp.size - 2].toInt() and 0xFF
            sw2 = resp[resp.size - 1]
        }
        val body = ByteArrayOutputStream()
        while (sw1 == 0x61) { // more data waiting: GET RESPONSE
            body.write(resp, 0, resp.size - 2)
            resp = transceive(byteArrayOf(0x00, 0xC0.toByte(), 0x00, 0x00, sw2))
            if (resp.size < 2) return null
            sw1 = resp[resp.size - 2].toInt() and 0xFF
            sw2 = resp[resp.size - 1]
        }
        if (sw1 != 0x90 || sw2 != 0x00.toByte()) return null
        body.write(resp, 0, resp.size - 2)
        return body.toByteArray()
    }

    companion object {
        /** Tried in order when the card has no PPSE directory. */
        private val KNOWN_AIDS = listOf(
            "A0000000031010", "A0000000032010", // Visa credit/debit, Visa Electron
            "A0000000041010", "A0000000043060", // Mastercard, Maestro
            "A0000005241010",                   // RuPay
            "A00000002501",                     // Amex
            "A0000001523010",                   // Diners / Discover
        ).map(::hex)

        private val AID_NETWORKS = listOf(
            "A000000003" to "visa",
            "A000000004" to "mastercard",
            "A000000524" to "rupay",
            "A000000025" to "amex",
            "A000000152" to "diners",
        )

        fun networkForAid(aid: ByteArray): String? {
            val h = toHex(aid)
            return AID_NETWORKS.firstOrNull { h.startsWith(it.first) }?.second
        }

        /** Fallback for an AID we don't map, from the IIN ranges the networks publish. */
        fun networkForPan(pan: String): String? {
            val p2 = pan.take(2).toIntOrNull() ?: return null
            val p4 = pan.take(4).toIntOrNull() ?: return null
            return when {
                pan.startsWith("4") -> "visa"
                p2 in 51..55 || p4 in 2221..2720 -> "mastercard"
                p2 == 34 || p2 == 37 -> "amex"
                p2 == 36 || p2 == 38 || p2 == 39 || pan.startsWith("30") -> "diners"
                p2 == 60 || p2 == 65 || p2 == 81 || p2 == 82 || pan.startsWith("508") || pan.startsWith("353") || pan.startsWith("356") -> "rupay"
                else -> null
            }
        }

        fun luhnValid(pan: String): Boolean {
            if (pan.length !in 12..19 || !pan.all { it.isDigit() }) return false
            var sum = 0
            pan.reversed().forEachIndexed { i, c ->
                var d = c - '0'
                if (i % 2 == 1) { d *= 2; if (d > 9) d -= 9 }
                sum += d
            }
            return sum % 10 == 0
        }

        /** BCD bytes as their hex digits, minus the 'F' padding cards append to odd lengths. */
        fun bcd(bytes: ByteArray): String = toHex(bytes).trimEnd('F')

        fun hex(s: String): ByteArray = ByteArray(s.length / 2) { i -> s.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

        private const val HEX = "0123456789ABCDEF"

        // Not String.format: that formats digits in the device locale.
        fun toHex(bytes: ByteArray): String = buildString(bytes.size * 2) {
            for (b in bytes) { append(HEX[(b.toInt() shr 4) and 0x0F]); append(HEX[b.toInt() and 0x0F]) }
        }

        private fun encodeLength(data: ByteArray): ByteArray = when {
            data.size < 0x80 -> byteArrayOf(data.size.toByte()) + data
            else -> byteArrayOf(0x81.toByte(), data.size.toByte()) + data
        }
    }
}

/** Just enough BER-TLV to walk EMV responses. */
object Tlv {
    /** (tag as int, number of tag bytes) at [offset]. */
    fun readTag(data: ByteArray, offset: Int): Pair<Int, Int> {
        var tag = data[offset].toInt() and 0xFF
        var n = 1
        if (tag and 0x1F == 0x1F) {
            while (offset + n < data.size) {
                val b = data[offset + n].toInt() and 0xFF
                tag = (tag shl 8) or b
                n++
                if (b and 0x80 == 0) break
            }
        }
        return tag to n
    }

    /** Every (tag, value) at every depth, in document order. Stops quietly at malformed data. */
    fun walk(data: ByteArray, visit: (Int, ByteArray) -> Unit) {
        var i = 0
        while (i < data.size) {
            val first = data[i].toInt() and 0xFF
            if (first == 0x00 || first == 0xFF) { i++; continue } // inter-record padding
            val (tag, tagLen) = readTag(data, i)
            i += tagLen
            if (i >= data.size) return
            var len = data[i].toInt() and 0xFF
            i++
            if (len and 0x80 != 0) {
                val count = len and 0x7F
                if (count == 0 || count > 3 || i + count > data.size) return
                len = 0
                repeat(count) { len = (len shl 8) or (data[i++].toInt() and 0xFF) }
            }
            if (i + len > data.size) return
            val value = data.copyOfRange(i, i + len)
            visit(tag, value)
            if (first and 0x20 != 0) walk(value, visit) // constructed: descend
            i += len
        }
    }

    fun find(data: ByteArray, tag: Int): ByteArray? {
        var hit: ByteArray? = null
        walk(data) { t, v -> if (hit == null && t == tag) hit = v }
        return hit
    }

    fun findAll(data: ByteArray, tag: Int): List<ByteArray> {
        val hits = mutableListOf<ByteArray>()
        walk(data) { t, v -> if (t == tag) hits += v }
        return hits
    }
}
