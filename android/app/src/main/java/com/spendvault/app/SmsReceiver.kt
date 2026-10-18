package com.spendvault.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.provider.Telephony
import android.util.Log

// Exported, but the manifest requires BROADCAST_SMS of whoever sends to it — a permission only the
// system's telephony stack holds — so no other installed app can hand SpendVault a forged bank SMS.
// The notification's Ignore button lives on NotificationActionReceiver for the same reason: the
// app's own broadcasts don't carry BROADCAST_SMS either.
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        // TEST_SMS is for `adb shell am broadcast` while developing. Only debug builds register it
        // (src/debug/AndroidManifest.xml); the check here keeps a release build ignoring it regardless.
        val isTest = action == "com.spendvault.app.TEST_SMS" &&
            (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

        if (action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION || isTest) {
            if (!SmsReaderPlugin.isSmsLoggingEnabled(context)) {
                Log.d("SmsReceiver", "Auto-Log SMS is disabled. Ignoring incoming SMS.")
                return
            }

            var body = ""
            var sender = "Unknown"

            if (isTest) {
                body = intent.getStringExtra("message") ?: ""
                sender = intent.getStringExtra("sender") ?: "TEST-SENDER"
            } else {
                val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                val fullBody = StringBuilder()
                for (sms in messages) {
                    fullBody.append(sms.displayMessageBody)
                    sender = sms.displayOriginatingAddress ?: "Unknown"
                }
                body = fullBody.toString()
            }

            if (body.isEmpty()) return
            // Never the body: logcat is readable over adb and in bug reports, and these messages
            // carry balances, card digits and OTPs.
            Log.d("SmsReceiver", "Processing an incoming SMS")

            try {
                val transaction = SmsParser.parse(body, sender)
                if (transaction != null) {
                    SmsReaderPlugin.notifyTransaction(context, transaction)
                }
            } catch (e: Exception) {
                Log.e("SmsReceiver", "Error parsing SMS", e)
            }
        }
    }
}
