package com.example.parwah

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.example.parwah.ui.navigation.ParwahNavGraph
import com.example.parwah.ui.theme.ParwahTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ParwahTheme {
                ParwahNavGraph()
            }
        }
    }
}