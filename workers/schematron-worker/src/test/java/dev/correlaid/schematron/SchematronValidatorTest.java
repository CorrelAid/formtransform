package dev.correlaid.schematron;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SchematronValidatorTest {
    static SchematronValidator schValidator;
    static XsdValidator xsdValidator;

    @BeforeAll
    static void setup() throws Exception {
        // Resolve paths: try repo root first, then parent (for running from schematron-worker/)
        Path schPath = Paths.get("schematron/ddi_custom_rules.sch");
        if (!Files.exists(schPath)) {
            schPath = Paths.get("../schematron/ddi_custom_rules.sch");
        }
        schValidator = new SchematronValidator(schPath);

        Path xsdPath = Paths.get("xml/codebook.xsd");
        if (!Files.exists(xsdPath)) {
            xsdPath = Paths.get("../xml/codebook.xsd");
        }
        xsdValidator = new XsdValidator(xsdPath);
    }

    // --- XSD tests ---

    @Test
    void validXmlPassesXsd() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/valid_sample.xml"));
        List<ValidationError> errors = xsdValidator.validate(xml);
        assertTrue(errors.isEmpty(), "Expected no XSD errors for valid XML, got: " + formatErrors(errors));
    }

    @Test
    void invalidElementDetectedByXsd() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/invalid_xsd_bad_element.xml"));
        List<ValidationError> errors = xsdValidator.validate(xml);
        assertFalse(errors.isEmpty(), "Expected XSD errors for invalid element");
        assertTrue(
            errors.stream().anyMatch(e -> e.rule.equals("xsd")),
            "Expected 'xsd' rule errors, got: " + formatErrors(errors)
        );
    }

    @Test
    void proveItXmlPassesXsd() throws Exception {
        Path proveIt = resolveSeedPath();
        if (proveIt == null) return;
        byte[] xml = Files.readAllBytes(proveIt);
        List<ValidationError> errors = xsdValidator.validate(xml);
        assertTrue(errors.isEmpty(), "Expected prove_it.xml to pass XSD, got: " + formatErrors(errors));
    }

    // --- Schematron tests ---

    @Test
    void validXmlPassesSchematron() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/valid_sample.xml"));
        List<ValidationError> errors = schValidator.validate(xml);
        assertTrue(errors.isEmpty(), "Expected no Schematron errors for valid XML, got: " + formatErrors(errors));
    }

    @Test
    void duplicateVarIdDetected() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/invalid_duplicate_id.xml"));
        List<ValidationError> errors = schValidator.validate(xml);
        assertFalse(errors.isEmpty(), "Expected errors for duplicate var ID");
        assertTrue(
            errors.stream().anyMatch(e -> e.message.contains("Duplicate Variable ID")),
            "Expected 'Duplicate Variable ID' error, got: " + formatErrors(errors)
        );
    }

    @Test
    void missingNameDetected() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/invalid_missing_label.xml"));
        List<ValidationError> errors = schValidator.validate(xml);
        assertFalse(errors.isEmpty(), "Expected errors for missing name attribute");
        assertTrue(
            errors.stream().anyMatch(e -> e.message.contains("missing a name attribute")),
            "Expected 'missing a name attribute' error, got: " + formatErrors(errors)
        );
    }

    @Test
    void lablOnVarDetected() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/invalid_labl_on_var.xml"));
        List<ValidationError> errors = schValidator.validate(xml);
        assertFalse(errors.isEmpty(), "Expected errors for labl on var");
        assertTrue(
            errors.stream().anyMatch(e -> e.message.contains("uses labl")),
            "Expected 'uses labl' error, got: " + formatErrors(errors)
        );
    }

    @Test
    void badVarGrpTypeDetected() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/invalid_vargrp_bad_type.xml"));
        List<ValidationError> errors = schValidator.validate(xml);
        assertFalse(errors.isEmpty(), "Expected errors for bad varGrp type");
        assertTrue(
            errors.stream().anyMatch(e -> e.message.contains("Only \"grid\" or \"multipleResp\" are supported")),
            "Expected varGrp type error, got: " + formatErrors(errors)
        );
    }

    @Test
    void categoricalWithoutCategoriesDetected() throws Exception {
        byte[] xml = Files.readAllBytes(Paths.get("src/test/resources/invalid_no_categories.xml"));
        List<ValidationError> errors = schValidator.validate(xml);
        assertFalse(errors.isEmpty(), "Expected errors for missing categories");
        assertTrue(
            errors.stream().anyMatch(e -> e.message.contains("categorical response domain but no catgry")),
            "Expected 'categorical response domain but no catgry' error, got: " + formatErrors(errors)
        );
    }

    @Test
    void proveItXmlPassesSchematron() throws Exception {
        Path proveIt = resolveSeedPath();
        if (proveIt == null) return;
        byte[] xml = Files.readAllBytes(proveIt);
        List<ValidationError> errors = schValidator.validate(xml);
        assertTrue(errors.isEmpty(), "Expected prove_it.xml to pass Schematron, got: " + formatErrors(errors));
    }

    // --- Helpers ---

    private static Path resolveSeedPath() {
        Path p = Paths.get("seed_data/prove_it.xml");
        if (Files.exists(p)) return p;
        p = Paths.get("../seed_data/prove_it.xml");
        if (Files.exists(p)) return p;
        return null;
    }

    private String formatErrors(List<ValidationError> errors) {
        StringBuilder sb = new StringBuilder();
        for (ValidationError e : errors) {
            sb.append("\n  - [").append(e.rule).append("] ").append(e.message)
              .append(" (test: ").append(e.test).append(", location: ").append(e.location).append(")");
        }
        return sb.toString();
    }
}
