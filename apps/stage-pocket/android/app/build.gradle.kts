import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import groovy.json.JsonSlurper

import java.util.Properties

val minSdkVersion: Int by rootProject.extra
val compileSdkVersion: Int by rootProject.extra
val targetSdkVersion: Int by rootProject.extra
val androidxAppCompatVersion: String by rootProject.extra
val androidxCoordinatorLayoutVersion: String by rootProject.extra
val coreSplashScreenVersion: String by rootProject.extra
val junitVersion: String by rootProject.extra
val androidxJunitVersion: String by rootProject.extra
val androidxEspressoCoreVersion: String by rootProject.extra
val okhttpVersion: String by rootProject.extra
val orgJsonVersion: String by rootProject.extra

val androidMinSdk = minSdkVersion
val androidCompileSdk = compileSdkVersion
val androidTargetSdk = targetSdkVersion
val brand = JsonSlurper().parse(rootProject.file("brand.json")) as Map<*, *>
val pocketAppId = brand["pocketAppId"] as String
val productName = brand["productName"] as String
val callbackScheme = brand["callbackScheme"] as String
val appVersionProperties = Properties().apply {
    rootProject.file("app-version.properties").inputStream().use(::load)
}
val androidVersionName = appVersionProperties.getProperty("AIRI_VERSION_NAME")
    ?: error("AIRI_VERSION_NAME is missing in android/app-version.properties")
val androidVersionCode = appVersionProperties.getProperty("AIRI_VERSION_CODE")
    ?.toIntOrNull()
    ?: error("AIRI_VERSION_CODE is missing or invalid in android/app-version.properties")

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ai.moeru.airi_pocket"
    compileSdk = androidCompileSdk

    defaultConfig {
        applicationId = pocketAppId
        manifestPlaceholders["brandProductName"] = productName
        manifestPlaceholders["brandCallbackScheme"] = callbackScheme
        minSdk = androidMinSdk
        targetSdk = androidTargetSdk
        versionCode = androidVersionCode
        versionName = androidVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            // The app ships for 64-bit ARM phones only. Each other ABI adds 24 to 41 MB of native libraries.
            // Emulators on Apple silicon also run arm64-v8a.
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android.txt"),
                "proguard-rules.pro",
            )
        }
    }
    androidResources {
        // Files and dirs to omit from the packaged assets dir, modified to accommodate modern web apps.
        // Default: https://android.googlesource.com/platform/frameworks/base/+/282e181b58cf72b6ca770dc7ca5f91f135444502/tools/aapt/AaptAssets.cpp#61
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}

repositories {
    flatDir {
        dirs("../capacitor-cordova-android-plugins/src/main/libs", "libs")
    }
}

dependencies {
    implementation(fileTree(mapOf("include" to listOf("*.jar"), "dir" to "libs")))
    implementation("androidx.appcompat:appcompat:$androidxAppCompatVersion")
    implementation("androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion")
    implementation("androidx.core:core-splashscreen:$coreSplashScreenVersion")
    implementation("com.squareup.okhttp3:okhttp:$okhttpVersion")
    // The Vite build downloads this AAR. Keep the name equal to `androidSherpaOnnxLibrary` in `@proj-airi/stage-shared/local-speech-model`.
    implementation(files("libs/sherpa-onnx-1.13.8.aar"))
    implementation(project(":capacitor-android"))
    testImplementation("junit:junit:$junitVersion")
    testImplementation("org.json:json:$orgJsonVersion")
    androidTestImplementation("androidx.test.ext:junit:$androidxJunitVersion")
    androidTestImplementation("androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion")
    implementation(project(":capacitor-cordova-android-plugins"))
}

apply(from = "capacitor.build.gradle")

try {
    val servicesJson = file("google-services.json")
    if (servicesJson.isFile && servicesJson.length() > 0) {
        apply(plugin = "com.google.gms.google-services")
    }
} catch (error: Exception) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
