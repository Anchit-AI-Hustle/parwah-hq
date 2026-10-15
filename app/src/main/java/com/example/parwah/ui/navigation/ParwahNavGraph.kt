package com.example.parwah.ui.navigation

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.example.parwah.ui.screens.AddTaskScreen
import com.example.parwah.ui.screens.HomeScreen
import com.example.parwah.viewmodel.CareViewModel

@Composable
fun ParwahNavGraph(
    navController: NavHostController = rememberNavController(),
    viewModel: CareViewModel = viewModel()
) {
    NavHost(
        navController = navController,
        startDestination = "home"
    ) {
        composable("home") {
            HomeScreen(
                viewModel = viewModel,
                onNavigateToAdd = {
                    navController.navigate("add_task")
                }
            )
        }
        composable("add_task") {
            AddTaskScreen(
                viewModel = viewModel,
                onNavigateBack = {
                    navController.popBackStack()
                }
            )
        }
    }
}