package com.parwah.android

import java.time.Duration
import java.time.Instant

object Time {
    /** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
    fun ago(iso: String, now: Instant = Instant.now()): String {
        val t = runCatching { Instant.parse(iso) }.getOrNull() ?: return ""
        val m = Duration.between(t, now).toMinutes()
        return when {
            m < 1 -> "just now"
            m < 60 -> if (m == 1L) "1 minute ago" else "$m minutes ago"
            m < 60 * 24 -> (m / 60).let { if (it == 1L) "1 hour ago" else "$it hours ago" }
            else -> (m / 1440).let { if (it == 1L) "yesterday" else "$it days ago" }
        }
    }
}
