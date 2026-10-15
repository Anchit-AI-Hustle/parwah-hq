package com.example.parwah.model

import java.util.UUID

data class CareTask(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val description: String,
    val isCompleted: Boolean = false
)