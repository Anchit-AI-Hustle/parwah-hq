pluginManagement {
    repositories {
        google()
        // Google's mirror of Maven Central first: the same artifacts, without
        // Central's per-address rate limit (429) that stalls shared build machines.
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // Google's mirror of Maven Central first: the same artifacts, without
        // Central's per-address rate limit (429) that stalls shared build machines.
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
    }
}
rootProject.name = "ParwahNative"
include(":core", ":app")
