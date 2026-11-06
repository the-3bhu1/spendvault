package com.spendvault.app

import com.spendvault.app.CardTextParser.Consensus
import com.spendvault.app.CardTextParser.Read
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar

class CardTextParserTest {

    private val nov2026 = Calendar.getInstance().apply { set(2026, Calendar.NOVEMBER, 6) }

    private fun parse(vararg lines: String) = CardTextParser.parse(lines.toList(), nov2026)

    private fun withLuhn(body: String): String = (0..9).map { body + it }.first { EmvReader.luhnValid(it) }

    private fun grouped(pan: String) = pan.chunked(4).joinToString(" ")

    @Test
    fun groupedNumberAndExpiry() {
        val pan = withLuhn("524193000000001")
        val r = parse("HDFC BANK", grouped(pan), "VALID THRU 08/29", "TRIBHUVAN K S")
        assertEquals(pan, r.pan)
        assertEquals(8 to 29, r.expiry)
    }

    @Test
    fun amexGrouping() {
        val pan = withLuhn("37144963539843")
        val r = parse("${pan.take(4)} ${pan.substring(4, 10)} ${pan.substring(10)}")
        assertEquals(pan, r.pan)
    }

    @Test
    fun ocrLettersInsideDigitGroupsAreFixed() {
        val pan = withLuhn("452100000000123")
        val misread = grouped(pan).replaceFirst('1', 'I').replaceFirst('0', 'O')
        assertEquals(pan, parse(misread).pan)
    }

    @Test
    fun wordsAreNotTurnedIntoDigits() {
        assertNull(parse("BOSS", "IOS 5").pan)
    }

    @Test
    fun luhnFailureIsRejected() {
        val pan = withLuhn("411111111111111")
        val wrong = pan.dropLast(1) + ((pan.last() - '0' + 1) % 10)
        assertNull(parse(grouped(wrong)).pan)
    }

    @Test
    fun numberCutOffByFrameIsRejected() {
        val cut = withLuhn("5268730007242")
        assertEquals(14, cut.length)
        assertNull(parse(grouped(cut)).pan)
    }

    @Test
    fun dinersFourteenDigits() {
        val pan = withLuhn("3056930902590")
        assertEquals(pan, parse("${pan.take(4)} ${pan.substring(4, 10)} ${pan.substring(10)}").pan)
    }

    @Test
    fun repeatedDigitsAreRejected() {
        assertNull(parse("0000 0000 0000 0000").pan)
        assertNull(parse("5555 5555 5555 5555").pan)
    }

    @Test
    fun trailingDigitsAfterNumberAreTrimmed() {
        val pan = withLuhn("524193000000001")
        assertEquals(pan, parse(grouped(pan) + " 123").pan)
    }

    @Test
    fun validFromAndThruPicksTheLater() {
        assertEquals(3 to 30, parse("VALID FROM 03/25", "VALID THRU 03/30").expiry)
    }

    @Test
    fun fourDigitYear() {
        assertEquals(11 to 28, parse("EXP 11/2028").expiry)
    }

    @Test
    fun implausibleYearsAreIgnored() {
        assertNull(parse("01/99", "12/10").expiry)
    }

    @Test
    fun consensusNeedsTwoMatchingNumbers() {
        val pan = withLuhn("524193000000001")
        val c = Consensus()
        assertNull(c.offer(Read(pan, 8 to 29)))
        val r = c.offer(Read(pan, 8 to 29))!!
        assertEquals(pan, r.pan)
        assertEquals(8, r.expiryMonth)
        assertEquals(29, r.expiryYear)
        assertEquals("mastercard", r.network)
    }

    @Test
    fun consensusIgnoresOneOffMisread() {
        val pan = withLuhn("524193000000001")
        val other = withLuhn("524193000000007")
        val c = Consensus()
        assertNull(c.offer(Read(pan, null)))
        assertNull(c.offer(Read(other, null)))
        assertNull(c.offer(Read(pan, 8 to 29)))
        val r = c.offer(Read(null, 8 to 29))!!
        assertEquals(pan, r.pan)
        assertEquals(8, r.expiryMonth)
    }

    @Test
    fun consensusGivesUpWaitingForExpiry() {
        val pan = withLuhn("411111111111111")
        val c = Consensus(panVotes = 2, graceFrames = 3)
        c.offer(Read(pan, null))
        assertNull(c.offer(Read(pan, null)))
        assertNull(c.offer(Read(null, null)))
        assertNull(c.offer(Read(null, null)))
        val r = c.offer(Read(null, null))!!
        assertEquals(pan, r.pan)
        assertNull(r.expiryMonth)
    }
}
