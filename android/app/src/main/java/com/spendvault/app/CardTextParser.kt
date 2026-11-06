package com.spendvault.app

import java.util.Calendar

object CardTextParser {

    data class Read(val pan: String?, val expiry: Pair<Int, Int>?)

    data class Result(val pan: String, val expiryMonth: Int?, val expiryYear: Int?, val network: String?)

    private val CONFUSABLE = mapOf('O' to '0', 'o' to '0', 'Q' to '0', 'I' to '1', 'l' to '1', '|' to '1', 'S' to '5', 'B' to '8', 'Z' to '2')

    private val DIGIT_RUN = Regex("""\d(?:[ \-]?\d){11,22}""")

    private val EXPIRY = Regex("""(?<!\d)(0[1-9]|1[0-2]) ?[/\-] ?(20\d{2}|\d{2})(?!\d)""")

    fun parse(lines: List<String>, now: Calendar = Calendar.getInstance()): Read {
        val cleaned = lines.map(::fixDigitTokens)
        return Read(cleaned.firstNotNullOfOrNull(::panIn), expiryIn(cleaned, now.get(Calendar.YEAR) % 100))
    }

    private fun fixDigitTokens(line: String): String = line.split(' ').joinToString(" ") { token ->
        val digits = token.count { it.isDigit() }
        if (token.length >= 3 && digits * 4 >= token.length * 3) token.map { CONFUSABLE[it] ?: it }.joinToString("")
        else token
    }

    private fun panIn(line: String): String? {
        for (match in DIGIT_RUN.findAll(line)) {
            val groups = match.value.split(' ', '-').filter { it.isNotEmpty() }
            groups.runningReduce { acc, g -> acc + g }
                .filter(::plausiblePan)
                .minByOrNull { when (it.length) { 16 -> 0; 15 -> 1; else -> 2 } }
                ?.let { return it }
        }
        return null
    }

    private fun plausiblePan(pan: String): Boolean =
        pan.length in printedLengths(pan) && pan.toSet().size > 1 && EmvReader.luhnValid(pan)

    private fun printedLengths(pan: String): Set<Int> = when {
        pan.startsWith("34") || pan.startsWith("37") -> setOf(15)
        pan.startsWith("30") || pan.startsWith("36") || pan.startsWith("38") || pan.startsWith("39") -> setOf(14, 16)
        pan.startsWith("4") -> setOf(16, 19)
        pan[0] in "2568" -> setOf(16)
        else -> emptySet()
    }

    private fun expiryIn(lines: List<String>, thisYear: Int): Pair<Int, Int>? =
        lines.flatMap { EXPIRY.findAll(it).toList() }
            .map { m -> m.groupValues[1].toInt() to m.groupValues[2].takeLast(2).toInt() }
            .filter { (_, yy) -> yy in (thisYear - 1)..(thisYear + 15) }
            .maxByOrNull { (mm, yy) -> yy * 12 + mm }

    class Consensus(private val panVotes: Int = 2, private val graceFrames: Int = 8) {
        private val pans = HashMap<String, Int>()
        private val expiries = HashMap<Pair<Int, Int>, Int>()
        private var confirmed: String? = null
        private var framesSinceConfirmed = 0

        fun offer(read: Read): Result? {
            read.expiry?.let { expiries[it] = (expiries[it] ?: 0) + 1 }
            val pan = confirmed?.also { framesSinceConfirmed++ } ?: run {
                val p = read.pan ?: return null
                val votes = (pans[p] ?: 0) + 1
                pans[p] = votes
                if (votes < panVotes) return null
                p.also { confirmed = it }
            }
            val best = expiries.maxByOrNull { it.value }
            if (best != null && best.value >= 2) return result(pan, best.key)
            if (framesSinceConfirmed >= graceFrames) return result(pan, best?.key)
            return null
        }

        private fun result(pan: String, expiry: Pair<Int, Int>?) =
            Result(pan, expiry?.first, expiry?.second, EmvReader.networkForPan(pan))
    }
}
