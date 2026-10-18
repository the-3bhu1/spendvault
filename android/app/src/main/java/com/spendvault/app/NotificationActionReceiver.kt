package com.spendvault.app

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

// The Ignore button on a "Transaction Detected" notification. Not exported: only SpendVault's own
// PendingIntent reaches it. It used to share SmsReceiver, which must now demand BROADCAST_SMS of its
// senders — a permission the app itself doesn't hold.
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CANCEL) return
        val notifId = intent.getIntExtra("notification_id", -1)
        Log.d("SpendVaultSms", "Cancel notification broadcast received: ID = $notifId")
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (notifId != -1) {
            manager.cancel(notifId)
        }
        // Clear the group summary notification (ID 9900) as well to keep the status bar 100% clean
        manager.cancel(9900)
    }

    companion object {
        const val ACTION_CANCEL = "com.spendvault.app.CANCEL_NOTIFICATION"
    }
}
