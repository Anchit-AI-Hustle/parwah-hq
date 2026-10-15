package com.example.parwah.viewmodel

import androidx.lifecycle.ViewModel
import com.example.parwah.model.CareTask
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class CareViewModel : ViewModel() {
    private val _tasks = MutableStateFlow<List<CareTask>>(
        listOf(
            CareTask(title = "Drink Water", description = "Drink at least 8 glasses of water today."),
            CareTask(title = "Meditate", description = "10 minutes of mindfulness."),
            CareTask(title = "Read a Book", description = "Read for 20 minutes.")
        )
    )
    val tasks: StateFlow<List<CareTask>> = _tasks.asStateFlow()

    fun addTask(title: String, description: String) {
        if (title.isNotBlank()) {
            _tasks.update { currentTasks ->
                currentTasks + CareTask(title = title, description = description)
            }
        }
    }

    fun toggleTaskCompletion(taskId: String) {
        _tasks.update { currentTasks ->
            currentTasks.map { task ->
                if (task.id == taskId) {
                    task.copy(isCompleted = !task.isCompleted)
                } else {
                    task
                }
            }
        }
    }

    fun removeTask(taskId: String) {
        _tasks.update { currentTasks ->
            currentTasks.filter { it.id != taskId }
        }
    }
}