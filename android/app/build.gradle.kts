plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.sovereignhq.fitflow"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.sovereignhq.fitflow"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        // The same key every build, so a new version installs over an old one.
        // CI restores it from a secret; locally it is the usual Android debug key.
        getByName("debug") {
            val fromCi = rootProject.file("../debug.keystore")
            if (fromCi.exists()) {
                storeFile = fromCi
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}

// The web app at the repository root is the single source of truth. It is copied
// into assets at build time rather than committed twice.
val bundleWebApp by tasks.registering(Copy::class) {
    from(rootProject.file("../index.html"))
    into(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(bundleWebApp) }
