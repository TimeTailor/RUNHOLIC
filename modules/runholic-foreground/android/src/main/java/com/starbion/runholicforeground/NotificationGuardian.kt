package com.starbion.runholicforeground

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationManagerCompat

class NotificationGuardian(
    private val context: Context,
    private val notificationId: Int,
    private val rebuild: () -> Notification
) {
    fun isVisible(): Boolean {
        val manager = NotificationManagerCompat.from(context)
        return manager.activeNotifications.any { it.id == notificationId }
    }

    fun ensurePosted(): Boolean {
        val visibleBefore = isVisible()

        if (!visibleBefore) {
            val nm =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(notificationId, rebuild())
        }

        return isVisible()
    }
}