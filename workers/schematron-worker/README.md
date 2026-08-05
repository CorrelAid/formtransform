# Validation Worker

A Java microservice that validates DDI-Codebook XML documents against XSD schema and [ISO Schematron](https://schematron.com/) business rules via NATS request-reply messaging.

## Consuming this worker

This lives in `survey-type-registry` and is **published as a prebuilt image**, so
downstream services (qwacback) don't build it:

- **Container image** — `ghcr.io/correlaid/schematron-worker:<version>`, built +
  pushed by `.github/workflows/worker-image.yml` on version tags, with the DDI
  2.5 XSDs + CDL rules from `ddi-validation/` baked in. Run it as a NATS service; downstream
  qwacback's own `REGISTRY_SYNC.md` documents how it consumes the image.
- **Build the image locally** (context = repo root):
  `docker build -f workers/schematron-worker/Dockerfile -t schematron-worker .`
- **CLI jar for the registry's own tests** — `bash scripts/build-worker.sh`
  produces `build/libs/*-all.jar`, invoked in CLI mode by
  `tests/transformations/test_ddi_validation.py`.

> The manual build/run commands further down assume the older qwacback-vendored
> layout (sibling `xml/` + `schematron/`); in this repo schemas live under
> `ddi-validation/` and the Docker build above wires them for you.

## How It Works

1. On startup:
   - The DDI-Codebook 2.5 XSD schema is loaded and compiled via `javax.xml.validation` (Java's built-in XSD support).
   - The `.sch` rules file is compiled into an XSLT stylesheet using [SchXslt2](https://codeberg.org/SchXslt/schxslt2) + [Saxon HE](https://www.saxonica.com/html/documentation12/about/whyfree.html) (XSLT 3.0). Both are cached in memory.
2. The worker subscribes to the NATS subject `schematron.validate`.
3. For each request, it decodes the base64-encoded XML and runs a two-stage validation:
   - **XSD validation** — checks structural compliance with DDI-Codebook 2.5 schema. If this fails, errors are returned immediately (Schematron is skipped).
   - **Schematron validation** — applies compiled XSLT and parses the [SVRL](http://schematron.com/document/4926.html) output for `<svrl:failed-assert>` elements.
4. It replies with a JSON response indicating validity and any errors.

## Project Structure

```
src/main/java/dev/correlaid/schematron/
  SchematronWorker.java      # NATS listener (main entry point)
  XsdValidator.java          # XSD schema loading + validation
  SchematronValidator.java   # .sch compilation + Schematron validation
  ValidationRequest.java     # Inbound POJO: { request_id, xml (base64) }
  ValidationResponse.java    # Outbound POJO: { request_id, valid, errors[] }
  ValidationError.java       # Error POJO: { rule, test, location, message }

src/test/java/dev/correlaid/schematron/
  SchematronValidatorTest.java   # Unit tests for both XSD and Schematron

src/test/resources/
  valid_sample.xml               # Valid DDI document
  invalid_xsd_bad_element.xml    # Triggers XSD validation failure
  invalid_duplicate_id.xml       # Triggers Schematron uniqueness pattern
  invalid_missing_label.xml      # Triggers Schematron essentials pattern
  invalid_no_categories.xml      # Triggers Schematron logic pattern
```

## NATS Message Format

**Request** (subject: `schematron.validate`):

```json
{
  "request_id": "uuid",
  "xml": "<base64-encoded DDI XML>"
}
```

**Reply**:

```json
{
  "request_id": "uuid",
  "valid": false,
  "errors": [
    {
      "rule": "xsd",
      "test": "",
      "location": "line 14, column 70",
      "message": "cvc-complex-type.2.4.a: Invalid content was found..."
    },
    {
      "rule": "schematron",
      "test": "ddi:labl",
      "location": "/codeBook/dataDscr/var[2]",
      "message": "Variable q2 is missing a label (labl)."
    }
  ]
}
```

The `rule` field distinguishes between `"xsd"` and `"schematron"` errors. XSD errors are returned first; if XSD fails, Schematron is not run.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `NATS_URL` | NATS server URL (connects to qwacback's embedded NATS) | `nats://localhost:4222` |
| `SCHEMATRON_PATH` | Path to the `.sch` rules file | `/app/schematron/ddi_custom_rules.sch` |
| `XSD_PATH` | Path to the XSD schema file | `/app/xml/codebook.xsd` |

## Dependencies

- **Java 21+**
- [Saxon HE 12.5](https://www.saxonica.com/) — XSLT 3.0 processor
- [SchXslt2 1.8](https://codeberg.org/SchXslt/schxslt2) — ISO Schematron to XSLT transpiler
- [jnats 2.20.5](https://github.com/nats-io/nats.java) — NATS client
- [Gson 2.11](https://github.com/google/gson) — JSON serialization

## Testing

Tests run against the real XSD schema and Schematron rules (no NATS needed).

### With local Gradle + JDK 21

You need JDK 21 and Gradle installed. The easiest way is via [sdkman](https://sdkman.io/):

```bash
sdk install java 21.0.6-tem
sdk install gradle
```

Then from the **repository root** (the tests reference `../schematron/` and `../xml/` relative to the `schematron-worker/` directory):

```bash
JAVA_HOME=~/.sdkman/candidates/java/21.0.6-tem \
  gradle -p schematron-worker test --no-daemon
```

Or if sdkman is already active in your shell:

```bash
gradle -p schematron-worker test --no-daemon
```

### With Docker

```bash
# From the repository root
docker run --rm \
  -v "$(pwd)/schematron-worker":/app/schematron-worker \
  -v "$(pwd)/schematron":/app/schematron \
  -v "$(pwd)/xml":/app/xml \
  -w /app/schematron-worker \
  gradle:8.12-jdk21 gradle test --no-daemon
```

## Building

```bash
# Fat JAR (includes all dependencies)
cd schematron-worker
gradle shadowJar

# The JAR is output to build/libs/schematron-worker-1.0.0-all.jar
java -jar build/libs/schematron-worker-1.0.0-all.jar
```

Or via Docker Compose from the repository root:

```bash
docker compose up --build schematron-worker
```
