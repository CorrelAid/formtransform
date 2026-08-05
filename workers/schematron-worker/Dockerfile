# Prebuilt schematron-worker image, built from this registry repo.
# Build context = repo root:  docker build -f workers/schematron-worker/Dockerfile .
# Published to GHCR by .github/workflows/worker-image.yml; consumed by qwacback
# (see briefs/downstream-sync/qwacback.md). DDI 2.5 XSDs + CDL schematron rules
# are baked in from ddi-validation/, so the image is self-contained.

# Build stage
FROM gradle:8.12-jdk21 AS builder
WORKDIR /app
COPY workers/schematron-worker/build.gradle.kts workers/schematron-worker/settings.gradle.kts ./
RUN gradle dependencies --no-daemon || true
COPY workers/schematron-worker/src/ src/
RUN gradle shadowJar --no-daemon

# Run stage
FROM eclipse-temurin:21-jre-alpine
RUN adduser -D -u 1001 appuser
WORKDIR /app
COPY --from=builder /app/build/libs/*-all.jar /app/worker.jar
# Schemas straight from the registry — single source of truth.
COPY ddi-validation/xsd/ /app/xml/
COPY ddi-validation/schematron/ /app/schematron/
RUN chown -R appuser:appuser /app

USER appuser
# Default schema locations (override via env if needed).
ENV XSD_PATH=/app/xml/codebook.xsd \
    SCHEMATRON_PATH=/app/schematron/ddi_custom_rules.sch
# NATS service entrypoint (SchematronWorker). CLI mode: override the entrypoint
# with `java -cp /app/worker.jar dev.correlaid.schematron.CliMain ...`.
ENTRYPOINT ["java", "-jar", "/app/worker.jar"]
