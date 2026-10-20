package com.parwah.core

/**
 * The PIN a person chooses. The same rule as the server's pinError
 * (api/_auth.mjs), word for word, so the phone refuses exactly what the
 * server would and says it the same way. PinTest checks every 4-number PIN
 * against native/contract/contract.json, which the server itself writes.
 */
object Pin {
    const val LENGTH = 4

    private val WEAK = setOf(
        "1234", "4321", "1212", "1122", "2580", "0852", "1004", "2000", "2020",
        "6969", "1313", "2468", "1357", "0123", "9876", "5683", "7777", "1010",
        "2121", "1111", "0000", "2001", "1990", "1230", "0007",
    )
    private const val GUESSABLE = "That PIN is one of the first anyone would try. Please pick another."

    /** Why this PIN cannot be chosen, or null when it can. */
    fun error(pin: String): String? {
        if (pin.isEmpty()) return "Choose a PIN of 4 numbers."
        if (!pin.all { it in '0'..'9' }) return "A PIN is numbers only - 4 of them."
        if (pin.length != LENGTH) return "A PIN is exactly 4 numbers, and you typed ${pin.length}."
        if (pin in WEAK || pin.all { it == pin[0] }) return GUESSABLE
        val d = pin.map { it - '0' }
        val up = (1 until d.size).all { d[it] == d[it - 1] + 1 }
        val down = (1 until d.size).all { d[it] == d[it - 1] - 1 }
        return if (up || down) GUESSABLE else null
    }
}
