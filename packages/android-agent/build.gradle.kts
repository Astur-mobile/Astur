plugins {
    id("com.android.application") version "8.13.2"
    id("org.jetbrains.kotlin.android") version "2.2.0"
}

android {
    namespace = "dev.astur.agent"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.astur.agent"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-alpha.0"
        testInstrumentationRunner = "dev.astur.agent.AsturInstrumentationRunner"
    }

    sourceSets {
        getByName("androidTest") {
            java.srcDir("../../agents/android-uiautomator")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
