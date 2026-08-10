plugins { id("com.android.application") }

android {
    namespace = "io.github.automacaofico.tracker"
    compileSdk { version = release(36) { minorApiLevel = 1 } }

    defaultConfig {
        applicationId = "io.github.automacaofico.tracker"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
        buildConfigField("String", "API_URL", "\"https://fico-tracking-api.automacaofico.workers.dev\"")
    }

    buildFeatures { buildConfig = true }
    buildTypes {
        release { isMinifyEnabled = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
