plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The gate UI lives once, in ../browser-extension/gate, and is shared with
// the Mac/Chrome extension. It's copied into the APK's assets at build time.
val gateSource = rootProject.file("../browser-extension/gate")
val generatedAssets = layout.buildDirectory.dir("generated/pauseAssets").get().asFile

val copyGate by tasks.registering(Copy::class) {
    from(gateSource)
    into(File(generatedAssets, "gate"))
}

android {
    namespace = "app.pause.urgegate"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.pause.urgegate"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "1.1.0"
    }

    signingConfigs {
        // Fixed (non-secret) debug key so every build — local or GitHub —
        // installs over the previous one without uninstalling.
        getByName("debug") {
            storeFile = file("pause-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
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

    sourceSets["main"].assets.srcDir(generatedAssets)
}

tasks.named("preBuild") { dependsOn(copyGate) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
}
