plugins {
    java
    application
    id("com.gradleup.shadow") version "8.3.6"
}

group = "dev.correlaid"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.nats:jnats:2.20.5")
    implementation("net.sf.saxon:Saxon-HE:12.5")
    implementation("name.dmaus.schxslt:schxslt2:1.8")
    implementation("com.google.code.gson:gson:2.11.0")
    implementation("org.slf4j:slf4j-api:2.0.16")
    implementation("ch.qos.logback:logback-classic:1.5.15")

    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    // Default entry point = NATS service. CLI entry point is selected at runtime
    // via `java -cp worker.jar dev.correlaid.schematron.CliMain ...`.
    mainClass.set("dev.correlaid.schematron.SchematronWorker")
}

// Convenience: `gradle runCli --args="--xsd ... --sch ... --xml ..."`
tasks.register<JavaExec>("runCli") {
    group = "application"
    description = "Run the one-shot CLI validator (no NATS)."
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.correlaid.schematron.CliMain")
}

tasks.test {
    useJUnitPlatform()
}
