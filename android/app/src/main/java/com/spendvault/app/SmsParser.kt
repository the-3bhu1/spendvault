package com.spendvault.app

import java.text.SimpleDateFormat
import java.text.Normalizer
import java.util.*
import java.util.regex.Pattern

data class Transaction(
    val amount: Double,
    val type: String, // "debit", "credit", "unknown"
    val merchant: String?,
    val source: String,
    val sourceIdentifier: String?, // e.g. "2355"
    val timestamp: Long,
    val rawMessage: String
)

object SmsParser {

    fun parse(message: String, sender: String): Transaction? {
        // 1. Filtering
        val lowerMessage = message.lowercase(Locale.ROOT)

        // Exclude request/approval spam messages
        val requestKeywords = listOf(
            "requested money",
            "requesting money",
            "has requested",
            "request from",
            "request to pay",
            "click here to approve",
            "on approving the request",
            "request pending"
        )
        if (requestKeywords.any { lowerMessage.contains(it) }) return null

        // Exclude promotional/offer SMS
        val promoKeywords = listOf(
            "valid till",
            "valid until",
            "t&c apply",
            "terms and conditions",
            "min. spend",
            "min spends",
            "minimum spend",
            "cashback awaits",
            "get cashback",
            "earn cashback",
            "offer ends",
            "offer valid",
            "use code",
            "promo code",
            "click to avail",
            "avail now",
            "limited period"
        )
        if (promoKeywords.any { lowerMessage.contains(it) }) return null

        // Exclude card/account verification and action-required marketing messages
        val verificationKeywords = listOf(
            "pending verification",
            "complete it now",
            "complete verification",
            "complete your kyc",
            "kyc pending",
            "verify your card",
            "verify your account",
            "account verification",
            "limit of up to",
            "credit limit of"
        )
        if (verificationKeywords.any { lowerMessage.contains(it) }) return null

        // Exclude bill/payment reminders and due notices — these are NOT actual
        // transactions. Only skip when the message does not also confirm a
        // completed transaction (so "Rs 189 paid via Bill Pay" still logs).
        val completedKeywords = listOf("debited", "credited", "spent", "paid", "sent", "deducted", "received", "withdrawn")
        val reminderKeywords = listOf(
            "amount due",
            "amt due",
            "payment due",
            "min due",
            "minimum due",
            "total due",
            "due date",
            "due by",
            "due on",
            "pay by",
            "pay instantly",
            "bill pay",
            "is due",
            "outstanding",
            "statement generated",
            "statement is generated",
            "e-statement",
            "kindly pay",
            "please pay"
        )
        val isReminder = reminderKeywords.any { lowerMessage.contains(it) }
        val isCompleted = completedKeywords.any { lowerMessage.contains(it) }
        if (isReminder && !isCompleted) return null

        // Exclude OTP/sensitive SMS. Privacy gate: such messages must never produce a
        // Transaction, so they are never dispatched to JS and never sent off-device to the
        // optional Gemini second filter. Real bank debit/credit confirmations do not contain
        // these phrases.
        val sensitiveKeywords = listOf(
            "otp",
            "one time password",
            "one-time password",
            "verification code",
            "verification pin",
            "security code",
            "login code",
            "auth code",
            "do not share",
            "never share",
            "is your code",
            "is your password"
        )
        if (sensitiveKeywords.any { lowerMessage.contains(it) }) return null

        val transactionKeywords = listOf("upi", "debited", "credited", "spent", "paid", "received", "txn", "sent", "top up", "topped up", "deducted", "card", "vpa")
        if (!transactionKeywords.any { lowerMessage.contains(it) }) return null

        // 2. Normalization (Handle fancy fonts and special symbols)
        val normalized = Normalizer.normalize(message, Normalizer.Form.NFKC)
            .lowercase(Locale.ROOT)
            .replace("₹", "rs")
            .replace("inr", "rs")
            .replace(",", "")
            .trim()

        // 3. Amount Extraction
        val amount = extractAmount(normalized)
        android.util.Log.d("SmsParser", "Extracted Amount: $amount")
        if (amount == null) return null

        // 4. Type Detection
        val type = detectType(normalized)
        android.util.Log.d("SmsParser", "Detected Type: $type")

        // 5. Merchant Extraction
        var merchant = extractMerchant(normalized, message)
        if (merchant == null && normalized.contains("salary")) {
            merchant = "Salary"
        }
        android.util.Log.d("SmsParser", "Extracted Merchant: $merchant")

        // 6. Source Extraction
        val source = extractSource(normalized) ?: sender
        android.util.Log.d("SmsParser", "Extracted Source: $source")

        // 6b. Source Identifier (Last 4 digits)
        val sourceIdentifier = extractSourceIdentifier(normalized)
        android.util.Log.d("SmsParser", "Extracted ID: $sourceIdentifier")

        // 7. Date/Timestamp Extraction
        val timestamp = extractTimestamp(normalized)

        return Transaction(
            amount = amount,
            type = type,
            merchant = merchant,
            source = source,
            sourceIdentifier = sourceIdentifier,
            timestamp = timestamp,
            rawMessage = message
        )
    }

    private fun extractAmount(text: String): Double? {
        // Priority 1: "amount of rs 100"
        val p1 = Pattern.compile("amount\\s+of\\s+rs\\.?\\s*(\\d+(\\.\\d{1,2})?)")
        val m1 = p1.matcher(text)
        if (m1.find()) return m1.group(1)?.toDoubleOrNull()

        // Priority 2: "rs 100"
        val p2 = Pattern.compile("rs\\.?\\s*(\\d+(\\.\\d{1,2})?)")
        val m2 = p2.matcher(text)
        if (m2.find()) {
            return m2.group(1)?.toDoubleOrNull()
        }
        return null
    }

    private fun detectType(text: String): String {
        return when {
            listOf("debited", "spent", "paid", "sent", "deducted").any { text.contains(it) } -> "debit"
            listOf("credited", "received", "top up", "topped up").any { text.contains(it) } -> "credit"
            else -> "unknown"
        }
    }

    private fun extractMerchant(text: String, original: String): String? {
        // Special Case: Axis Bank standalone merchant after IST
        if (text.contains("axis bank") && text.contains("ist")) {
            val istIndex = text.indexOf("ist")
            if (istIndex != -1) {
                var segment = text.substring(istIndex + 3).trim()
                val limitIndex = segment.indexOf("avl limit")
                if (limitIndex != -1) segment = segment.substring(0, limitIndex).trim()

                val blockIndex = segment.indexOf("not you?")
                if (blockIndex != -1) segment = segment.substring(0, blockIndex).trim()

                if (segment.isNotEmpty() && segment.length > 2) {
                   return restoreCase(original, segment)
                }
            }
        }

        // '*' and '&' belong to the merchant, not to the punctuation we stop on — card networks
        // send descriptors like "Cashfree*FLIPKART INTE" and "PAYU*Swiggy". \b keeps a keyword
        // from matching inside a word ("auto ", "into ").
        val body = "([a-zA-Z0-9@.*&'/\\- ]+)"
        val patterns = listOf(
            Pattern.compile("\\btowards\\s+$body"),
            Pattern.compile("\\bto\\s+$body"),
            Pattern.compile("\\bat\\s+$body"),
            Pattern.compile("\\bfrom\\s+$body")
        )

        // Position in the message decides, NOT the order of the list above. Bank footers carry
        // "Not You? To Block+Reissue call ..." and "SMS BLOCK CC 2355 to 7308080808", so trying
        // "to" ahead of "at" read the footer as the merchant ("Block") and never got as far as
        // the real "at <merchant>" earlier in the same SMS.
        val candidates = mutableListOf<Pair<Int, String>>()
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            while (matcher.find()) {
                val value = matcher.group(1)?.trim().orEmpty()
                if (value.isNotEmpty()) candidates.add(matcher.start() to value)
            }
        }
        candidates.sortBy { it.first }

        for ((_, candidate) in candidates) {
            var merchant = candidate

            // Cleanup: Ignore generic account mentions. The a/c test is a contains, not a prefix:
            // "Sent Rs.2000 from HDFC Bank A/C x1234 to john@upi" must fall through to the "to"
            // leg rather than log the sending account as the payee.
            val ignorePrefixes = listOf("your account", "my account", "self account", "a/c", "acc", "xxxx", "your hdfc bank", "your bank", "your axis bank")
            if (ignorePrefixes.any { merchant.lowercase().startsWith(it) }) continue
            if (merchant.contains("a/c")) continue

            // Post-processing: Remove trailing segments. " from " ends the payee in "paid to
            // NETFLIX.COM from Kotak Bank Card 5678"; the balance clauses end it in "at
            // ATM/CASH/CHENNAI. Avl bal Rs 9000" — both previously leaked into the description.
            val separators = listOf(" on ", " via ", " for ", " using ", ".not you?", " ref ", " upi ", " umrn:", " dial ", " if ", " ist ",
                " from ", " avl bal", " avl lmt", " avl limit", " available bal")
            for (sep in separators) {
                if (merchant.contains(sep)) {
                    merchant = merchant.substring(0, merchant.indexOf(sep)).trim()
                }
            }

            // Cleanup trailing dots or special chars
            merchant = merchant.replace(Regex("[^a-zA-Z0-9@.\\- ]$"), "").trim()

            // Don't treat "a/c" or "acc" as the merchant if it's just account info
            if (merchant.startsWith("a/c") || merchant.startsWith("acc")) continue

            // Safety-footer boilerplate and bare phone numbers are never the merchant. Still
            // needed after the ordering fix, for messages that carry no "at <merchant>" at all
            // and where the footer is therefore the only candidate.
            val rejects = listOf("block", "report", "call", "dial", "stop", "unsubscribe", "know more")
            if (rejects.any { merchant == it || merchant.startsWith("$it ") }) continue
            if (merchant.all { it.isDigit() || it == ' ' }) continue

            if (merchant.length > 2) return restoreCase(original, merchant)
        }
        return null
    }

    // Parsing runs on a lowercased copy, but a merchant reads better in the casing the bank sent
    // it ("Cashfree*FLIPKART INTE", not "Cashfree*flipkart inte"). Map the match back onto the
    // original text; if normalization altered that span (₹/INR, commas) fall back to title case.
    private fun restoreCase(original: String, lowered: String): String {
        val idx = original.lowercase(Locale.ROOT).indexOf(lowered)
        if (idx >= 0) return original.substring(idx, idx + lowered.length)
        return lowered.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
    }

    private fun extractSourceIdentifier(text: String): String? {
        // Look for digits after card, a/c, acc, xxxx, etc.
        val patterns = listOf(
            Pattern.compile("card\\s+(\\d+)"),
            Pattern.compile("a/c\\s*x*(\\d+)"),
            Pattern.compile("acc\\s*x*(\\d+)"),
            Pattern.compile("x{2,}(\\d+)"),
            Pattern.compile("ending\\s+(?:with\\s+)?(\\d+)")
        )
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                val id = matcher.group(1) ?: continue
                return if (id.length > 4) id.substring(id.length - 4) else id
            }
        }
        return null
    }

    private fun extractSource(text: String): String? {
        val patterns = listOf(
            Pattern.compile("-\\s*([a-zA-Z0-9 ]+bank)"),
            Pattern.compile("([a-zA-Z0-9]+ bank)")
        )
        for (pattern in patterns) {
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                return matcher.group(1)?.trim()?.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
            }
        }
        return null
    }

    private fun extractTimestamp(text: String): Long {
        // Format 1: on yyyy-MM-dd:HH:mm:ss (HDFC)
        try {
            val pattern1 = Pattern.compile("on\\s(\\d{4}-\\d{2}-\\d{2}:\\d{2}:\\d{2}:\\d{2})")
            val matcher1 = pattern1.matcher(text)
            if (matcher1.find()) {
                val dateStr = matcher1.group(1)
                val sdf = SimpleDateFormat("yyyy-MM-dd:HH:mm:ss", Locale.ROOT)
                return sdf.parse(dateStr)?.time ?: System.currentTimeMillis()
            }
        } catch (e: Exception) {}

        // Format 2: dd-MM-yy HH:mm:ss (Axis Bank)
        try {
            // Updated pattern to handle 1 or 2 digits for day/month and 2 or 4 digits for year
            val pattern2 = Pattern.compile("(\\d{1,2}-\\d{1,2}-\\d{2,4}\\s\\d{2}:\\d{2}:\\d{2})")
            val matcher2 = pattern2.matcher(text)
            if (matcher2.find()) {
                val dateStr = matcher2.group(1)
                // Try multiple formats for Format 2 as well
                val formats2 = listOf("dd-MM-yy HH:mm:ss", "d-M-yy HH:mm:ss", "dd-MM-yyyy HH:mm:ss", "d-M-yyyy HH:mm:ss")
                for (f in formats2) {
                    try {
                        val sdf = SimpleDateFormat(f, Locale.ROOT)
                        sdf.isLenient = false
                        val date = sdf.parse(dateStr) ?: continue
                        
                        val cal = Calendar.getInstance()
                        cal.time = date
                        var year = cal.get(Calendar.YEAR)
                        if (year < 100) {
                            year += 2000
                            cal.set(Calendar.YEAR, year)
                        }
                        return cal.timeInMillis
                    } catch (e: Exception) {}
                }
            }
        } catch (e: Exception) {}

        // Flexible date extraction for dd/MM/yyyy, dd/MM/yy, dd-MM-yy, d/m/yy etc.
        val datePatterns = listOf(
            "on\\s(\\d{1,2}/\\d{1,2}/\\d{2,4})",
            "on\\s(\\d{1,2}-\\d{1,2}-\\d{2,4})"
        )
        val formats = listOf(
            "dd/MM/yyyy", "dd/MM/yy", "d/M/yy", "d/M/yyyy", "dd-MM-yyyy", "dd-MM-yy", "d-M-yy", "d-M-yyyy"
        )

        for (p in datePatterns) {
            try {
                val matcher = Pattern.compile(p).matcher(text)
                if (matcher.find()) {
                    val dateStr = matcher.group(1)
                    for (f in formats) {
                        try {
                            val sdf = SimpleDateFormat(f, Locale.ROOT)
                            sdf.isLenient = false
                            val date = sdf.parse(dateStr) ?: continue
                            
                            val cal = Calendar.getInstance()
                            cal.time = date
                            var year = cal.get(Calendar.YEAR)
                            // If year is parsed as 2-digit (e.g. 26 -> 0026), adjust to 2026
                            if (year < 100) {
                                year += 2000
                                cal.set(Calendar.YEAR, year)
                            }
                            return cal.timeInMillis
                        } catch (e: Exception) {}
                    }
                }
            } catch (e: Exception) {}
        }

        return System.currentTimeMillis()
    }
}
