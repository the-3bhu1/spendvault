package com.spendvault.app

import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

import java.util.LinkedList
import org.json.JSONArray
import org.json.JSONObject

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

@CapacitorPlugin(
    name = "SmsReader",
    permissions = [
        Permission(
            alias = "sms",
            strings = [
                android.Manifest.permission.RECEIVE_SMS,
                android.Manifest.permission.READ_SMS
            ]
        ),
        Permission(
            alias = "notifications",
            strings = [
                "android.permission.POST_NOTIFICATIONS"
            ]
        )
    ]
)
class SmsReaderPlugin : Plugin() {

    companion object {
        private var instance: SmsReaderPlugin? = null
        private var activeActivities = 0
        
        private const val PREFS_NAME = "SmsReaderPluginPrefs"
        private const val QUEUE_KEY = "pendingTransactions"
        private const val ENABLED_KEY = "smsAutoLogEnabled"
        private val queueLock = Any()

        private const val CHANNEL_ID = "spendvault_transaction_alerts"
        private const val CHANNEL_NAME = "Transaction Alerts"
        private const val CHANNEL_DESC = "Notifications for auto-detected SMS bank transactions waiting for confirmation."
        private const val GROUP_KEY = "com.spendvault.TRANSACTIONS"
        private const val SUMMARY_NOTIFICATION_ID = 9900

        val isAppInForeground: Boolean
            get() = activeActivities > 0

        fun notifyTransaction(context: Context, tx: Transaction) {
            val ret = JSONObject()
            ret.put("amount", tx.amount)
            ret.put("type", tx.type)
            ret.put("merchant", tx.merchant)
            ret.put("source", tx.source)
            ret.put("sourceIdentifier", tx.sourceIdentifier)
            ret.put("timestamp", tx.timestamp)
            ret.put("raw", tx.rawMessage)

            val plugin = instance
            
            // Production-grade Persistent Deduplication Logic
            val dedupeKey = "${tx.amount}_${tx.timestamp}_${tx.source}_${tx.merchant ?: ""}"
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val processedSet = prefs.getStringSet("processedHashes", emptySet()) ?: emptySet()
            if (processedSet.contains(dedupeKey)) {
                android.util.Log.d("SpendVaultSms", "Duplicate transaction skipped: $dedupeKey")
                return
            }

            // Save to persistent hash list (capped to last 100 entries)
            val newSet = processedSet.toMutableSet()
            newSet.add(dedupeKey)
            if (newSet.size > 100) {
                val list = newSet.toList()
                val trimmed = list.subList(list.size - 100, list.size)
                prefs.edit().putStringSet("processedHashes", trimmed.toSet()).apply()
            } else {
                prefs.edit().putStringSet("processedHashes", newSet).apply()
            }

            synchronized(queueLock) {
                if (isAppInForeground && plugin != null && plugin.hasListeners("onTransaction")) {
                    android.util.Log.d("SpendVaultSms", "App in foreground. Dispatching directly to JS listener.")
                    plugin.dispatchTransaction(ret)
                } else {
                    android.util.Log.d("SpendVaultSms", "App is closed/background. Saving to persistent queue & posting notification.")
                    saveToQueue(context, ret)
                    sendLocalNotification(context, tx)
                }
            }
        }

        private fun sendLocalNotification(context: Context, tx: Transaction) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // 1. Create Notification Channel (Android O+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                var channel = notificationManager.getNotificationChannel(CHANNEL_ID)
                if (channel == null) {
                    channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH).apply {
                        description = CHANNEL_DESC
                        enableLights(true)
                        enableVibration(true)
                    }
                    notificationManager.createNotificationChannel(channel)
                }
            }

            // 2. Setup Open App PendingIntent
            val launchIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("open_pending_transactions", true)
            }
            
            val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            
            val notificationId = System.currentTimeMillis().toInt()
            val openPendingIntent = PendingIntent.getActivity(context, notificationId, launchIntent, pendingFlags)

            // 3. Setup Ignore Action PendingIntent (Broadcast to cancelling receiver)
            val ignoreIntent = Intent(context, SmsReceiver::class.java).apply {
                action = "com.spendvault.app.CANCEL_NOTIFICATION"
                putExtra("notification_id", notificationId)
            }
            
            // Broadcast intent must also respect FLAG_IMMUTABLE on Android 12+
            val ignorePendingIntent = PendingIntent.getBroadcast(context, notificationId + 1, ignoreIntent, pendingFlags)

            // 4. Formatting Indian currency & merchant strings
            val typeWord = if (tx.type == "credit") "received" else "spent"
            val merchantText = if (!tx.merchant.isNullOrEmpty()) " at ${tx.merchant}" else ""
            val formattedAmount = formatIndianCurrency(tx.amount)

            val title = "Transaction Detected"
            val message = "$formattedAmount $typeWord$merchantText. Tap to review."

            android.util.Log.d("SpendVaultSms", "Posting Notification: ID = $notificationId, content = $message")

            // 4.5 Load application icon as Bitmap for Large Icon branding (supports modern Adaptive Icons)
            val appIconBitmap = try {
                val drawable = androidx.core.content.res.ResourcesCompat.getDrawable(
                    context.resources,
                    context.applicationInfo.icon,
                    context.theme
                )
                if (drawable != null) {
                    val width = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else 128
                    val height = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else 128
                    val bitmap = android.graphics.Bitmap.createBitmap(
                        width,
                        height,
                        android.graphics.Bitmap.Config.ARGB_8888
                    )
                    val canvas = android.graphics.Canvas(bitmap)
                    drawable.setBounds(0, 0, canvas.width, canvas.height)
                    drawable.draw(canvas)
                    bitmap
                } else {
                    null
                }
            } catch (e: Exception) {
                android.util.Log.e("SpendVaultSms", "Failed to draw application icon bitmap", e)
                null
            }

            // 5. Build individual notification banner
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setContentIntent(openPendingIntent)
                .setAutoCancel(true)
                .setGroup(GROUP_KEY)
                .addAction(R.drawable.ic_notification, "Open App", openPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Ignore", ignorePendingIntent)

            if (appIconBitmap != null) {
                builder.setLargeIcon(appIconBitmap)
            }

            // 6. Post individual notification
            notificationManager.notify(notificationId, builder.build())

            // 7. Post/Update grouped summary notification to prevent notification status bar spam
            val summaryBuilder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("SpendVault Alerts")
                .setContentText("New transactions detected")
                .setStyle(NotificationCompat.InboxStyle().setSummaryText("Pending transactions"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup(GROUP_KEY)
                .setGroupSummary(true)
                .setAutoCancel(true)

            if (appIconBitmap != null) {
                summaryBuilder.setLargeIcon(appIconBitmap)
            }

            notificationManager.notify(SUMMARY_NOTIFICATION_ID, summaryBuilder.build())
        }

        private fun formatIndianCurrency(amount: Double): String {
            val formatter = java.text.NumberFormat.getCurrencyInstance(java.util.Locale("en", "IN"))
            var result = formatter.format(amount)
            if (result.startsWith("Rs.")) {
                result = result.replace("Rs.", "₹")
            } else if (result.startsWith("INR")) {
                result = result.replace("INR", "₹")
            } else if (!result.startsWith("₹")) {
                result = "₹$result"
            }
            if (result.endsWith(".00")) {
                result = result.substring(0, result.length - 3)
            }
            return result
        }

        private fun saveToQueue(context: Context, tx: JSONObject) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val queueJson = prefs.getString(QUEUE_KEY, "[]")
            val queue = JSONArray(queueJson)
            queue.put(tx)
            prefs.edit().putString(QUEUE_KEY, queue.toString()).apply()
            android.util.Log.d("SpendVaultSms", "Transaction saved to queue in SharedPreferences")
        }

        fun drainQueueAtomic(context: Context): JSONArray {
            synchronized(queueLock) {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val queueJson = prefs.getString(QUEUE_KEY, "[]")
                val queue = JSONArray(queueJson)
                prefs.edit().remove(QUEUE_KEY).apply()
                android.util.Log.d("SpendVaultSms", "Drained persistent queue atomically")
                return queue
            }
        }

        fun isSmsLoggingEnabled(context: Context): Boolean {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return prefs.getBoolean(ENABLED_KEY, false)
        }

        private fun setSmsLoggingEnabled(context: Context, enabled: Boolean) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().putBoolean(ENABLED_KEY, enabled).apply()
        }
    }

    override fun load() {
        super.load()
        android.util.Log.d("SpendVaultSms", "SmsReaderPlugin Loaded Successfully")
        instance = this

        // Register Activity Lifecycle callbacks to track foreground/background state
        val app = context.applicationContext as? Application
        app?.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {
                activeActivities++
                android.util.Log.d("SpendVaultSms", "Activity started. Active count = $activeActivities, Foreground = $isAppInForeground")
            }
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {
                activeActivities = Math.max(0, activeActivities - 1)
                android.util.Log.d("SpendVaultSms", "Activity stopped. Active count = $activeActivities, Foreground = $isAppInForeground")
            }
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    private fun dispatchTransaction(tx: JSONObject) {
        if (hasListeners("onTransaction")) {
            android.util.Log.d("SpendVaultSms", "Notifying JS listener with transaction: $tx")
            notifyListeners("onTransaction", JSObject.fromJSONObject(tx))
            return
        }
        android.util.Log.d("SpendVaultSms", "JS listener missing. Saving to persistent queue.")
        saveToQueue(context, tx)
    }

    @PluginMethod
    fun ping(call: PluginCall) {
        android.util.Log.d("SpendVaultSms", "Ping received from JS")
        call.resolve()
    }

    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) ?: false
        setSmsLoggingEnabled(context, enabled)
        android.util.Log.d("SpendVaultSms", "SMS auto-log enabled set to $enabled")
        call.resolve()
    }

    @PluginMethod
    override fun checkPermissions(call: PluginCall) {
        super.checkPermissions(call)
    }

    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        super.requestPermissions(call)
    }

    @PluginMethod
    fun drainPendingTransactions(call: PluginCall) {
        val queue = drainQueueAtomic(context)
        android.util.Log.d("SpendVaultSms", "Draining ${queue.length()} pending transaction(s) to JS")
        val ret = JSObject()
        ret.put("transactions", queue)
        call.resolve(ret)
    }

    @PluginMethod
    fun checkLaunchIntent(call: PluginCall) {
        val activity = bridge?.activity
        val intent = activity?.intent
        val openPending = intent?.getBooleanExtra("open_pending_transactions", false) ?: false
        if (openPending) {
            android.util.Log.d("SpendVaultSms", "Launch Intent extra 'open_pending_transactions' detected as TRUE. Clearing flag and notification tray.")
            intent.removeExtra("open_pending_transactions")
            
            // Clean up the notification tray completely upon launching/resuming from the notification
            try {
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.cancelAll()
            } catch (e: Exception) {
                android.util.Log.e("SpendVaultSms", "Failed to cancel notifications on launch", e)
            }
        }
        val ret = JSObject()
        ret.put("openPending", openPending)
        call.resolve(ret)
    }
}
