package com.spendvault.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import android.app.NotificationManager

class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        
        if (action == "com.spendvault.app.CANCEL_NOTIFICATION") {
            val notifId = intent.getIntExtra("notification_id", -1)
            Log.d("SpendVaultSms", "Cancel notification broadcast received: ID = $notifId")
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (notifId != -1) {
                manager.cancel(notifId)
            }
            // Clear the group summary notification (ID 9900) as well to keep the status bar 100% clean
            manager.cancel(9900)
            return
        }

        if (action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION || action == "com.spendvault.app.TEST_SMS") {
            if (!SmsReaderPlugin.isSmsLoggingEnabled(context)) {
                Log.d("SmsReceiver", "Auto-Log SMS is disabled. Ignoring incoming SMS.")
                return
            }

            var body = ""
            var sender = "Unknown"

            if (action == "com.spendvault.app.TEST_SMS") {
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
            Log.d("SmsReceiver", "Processing SMS from $sender: $body")

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
