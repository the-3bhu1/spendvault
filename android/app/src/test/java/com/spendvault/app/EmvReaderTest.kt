package com.spendvault.app

import com.spendvault.app.EmvReader.Companion.hex
import com.spendvault.app.EmvReader.Companion.toHex
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Runs the whole APDU sequence against a scripted card. Commands are matched by hex prefix, so
 * GPO — whose body carries today's date and a random number — matches on its header alone.
 * Anything unscripted gets 6A82 (file not found), which is what a real card says.
 */
class EmvReaderTest {

    private fun tlv(tag: String, value: ByteArray): ByteArray {
        val len = if (value.size < 0x80) byteArrayOf(value.size.toByte())
        else byteArrayOf(0x81.toByte(), value.size.toByte())
        return hex(tag) + len + value
    }

    private fun tlv(tag: String, vararg children: ByteArray): ByteArray =
        tlv(tag, children.fold(ByteArray(0)) { acc, c -> acc + c })

    private val OK = hex("9000")

    private fun selectCmd(name: ByteArray) = "00A40400" + toHex(byteArrayOf(name.size.toByte()) + name)

    private fun ppse(vararg aids: String) = tlv(
        "6F", tlv("84", "2PAY.SYS.DDF01".toByteArray()),
        tlv("A5", tlv("BF0C", *aids.map { tlv("61", tlv("4F", hex(it)), tlv("87", hex("01"))) }.toTypedArray()))
    )

    private fun card(vararg script: Pair<String, ByteArray>) = EmvReader { apdu ->
        val cmd = toHex(apdu)
        script.firstOrNull { cmd.startsWith(it.first) }?.second ?: hex("6A82")
    }

    /** Appends the Luhn check digit, so test PANs are valid without hard-coding real ones. */
    private fun withLuhn(body: String): String =
        (0..9).map { body + it }.first { EmvReader.luhnValid(it) }

    @Test
    fun visa_track2InGpoResponse() {
        val aid = "A0000000031010"
        val fci = tlv("6F", tlv("84", hex(aid)), tlv("A5", tlv("50", "VISA DEBIT".toByteArray()), tlv("9F38", hex("9F66049F02069F3704"))))
        val pan = withLuhn("411111111111111")
        val r = card(
            selectCmd("2PAY.SYS.DDF01".toByteArray()) to ppse(aid) + OK,
            selectCmd(hex(aid)) to fci + OK,
            "80A80000" to tlv("77", tlv("82", hex("2000")), tlv("57", hex(pan + "D29122011234567890000F"))) + OK,
        ).read()
        assertEquals(pan, r.pan)
        assertEquals(12, r.expiryMonth)
        assertEquals(29, r.expiryYear)
        assertEquals("visa", r.network)
        assertEquals("VISA DEBIT", r.label)
    }

    @Test
    fun mastercard_format1GpoThenReadRecord() {
        val aid = "A0000000041010"
        val pan = withLuhn("555555555555444")
        val r = card(
            selectCmd("2PAY.SYS.DDF01".toByteArray()) to ppse(aid) + OK,
            selectCmd(hex(aid)) to tlv("6F", tlv("84", hex(aid)), tlv("A5", tlv("50", "MASTERCARD".toByteArray()))) + OK,
            // AIP 1980, AFL: SFI 1, records 1..1
            "80A80000" to tlv("80", hex("1980" + "08010100")) + OK,
            "00B2010C" to tlv("70", tlv("5A", hex(pan)), tlv("5F24", hex("270630"))) + OK,
        ).read()
        assertEquals(pan, r.pan)
        assertEquals(6, r.expiryMonth)
        assertEquals(27, r.expiryYear)
        assertEquals("mastercard", r.network)
    }

    @Test
    fun rupay_noPpse_gpoRefused_fallsBackToRecordScan() {
        val aid = "A0000005241010"
        val pan = withLuhn("652100000000123")
        val r = card(
            selectCmd(hex(aid)) to tlv("6F", tlv("84", hex(aid))) + OK,
            "80A80000" to hex("6985"),
            "00B2021C" to tlv("70", tlv("5A", hex(pan)), tlv("5F24", hex("300131"))) + OK, // SFI 3, record 2
        ).read()
        assertEquals(pan, r.pan)
        assertEquals(1, r.expiryMonth)
        assertEquals(30, r.expiryYear)
        assertEquals("rupay", r.network)
        assertNull(r.label)
    }

    @Test
    fun getResponse_isFollowed() {
        val aid = "A0000000031010"
        val pan = withLuhn("411111111111111")
        val gpo = tlv("77", tlv("57", hex(pan + "D2501201")))
        val r = card(
            selectCmd("2PAY.SYS.DDF01".toByteArray()) to ppse(aid) + OK,
            selectCmd(hex(aid)) to tlv("6F", tlv("84", hex(aid))) + OK,
            "80A80000" to hex("61" + "%02X".format(gpo.size)),
            "00C00000" to gpo + OK,
        ).read()
        assertEquals(pan, r.pan)
        assertEquals(1, r.expiryMonth)
        assertEquals(25, r.expiryYear)
    }

    @Test
    fun badChecksum_isReadFailed() {
        val aid = "A0000000031010"
        try {
            card(
                selectCmd("2PAY.SYS.DDF01".toByteArray()) to ppse(aid) + OK,
                selectCmd(hex(aid)) to tlv("6F", tlv("84", hex(aid))) + OK,
                "80A80000" to tlv("77", tlv("57", hex("4111111111111112D2912201"))) + OK,
            ).read()
            fail("expected READ_FAILED")
        } catch (e: EmvReader.EmvException) {
            assertEquals("READ_FAILED", e.code)
        }
    }

    @Test
    fun nonPaymentCard_isNotEmv() {
        try {
            card().read()
            fail("expected NOT_EMV")
        } catch (e: EmvReader.EmvException) {
            assertEquals("NOT_EMV", e.code)
        }
    }

    @Test
    fun networkForPan_coversIndianRanges() {
        assertEquals("visa", EmvReader.networkForPan("4111111111111111"))
        assertEquals("mastercard", EmvReader.networkForPan("2221000000000009"))
        assertEquals("amex", EmvReader.networkForPan("371449635398431"))
        assertEquals("rupay", EmvReader.networkForPan("6521000000000000"))
        assertNull(EmvReader.networkForPan("9999999999999999"))
    }

    @Test
    fun tlv_longFormLengthAndPadding() {
        val big = ByteArray(200) { 0x41 }
        val data = hex("0000") + tlv("70", tlv("50", big)) + hex("FFFF")
        assertTrue(Tlv.find(data, 0x50)!!.contentEquals(big))
    }
}
