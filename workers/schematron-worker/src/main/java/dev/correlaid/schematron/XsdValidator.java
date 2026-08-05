package dev.correlaid.schematron;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.Schema;
import javax.xml.validation.SchemaFactory;
import javax.xml.validation.Validator;
import java.io.ByteArrayInputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Validates XML documents against DDI-Codebook 2.5 XSD schema.
 *
 * On construction, loads and compiles the XSD schema (including imports).
 * The compiled Schema object is thread-safe and cached for reuse.
 */
public class XsdValidator {
    private static final Logger log = LoggerFactory.getLogger(XsdValidator.class);

    private final Schema schema;

    public XsdValidator(Path xsdPath) throws SAXException {
        log.info("Loading XSD schema: {}", xsdPath);
        SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
        // During schema compilation we must allow "file" access because codebook.xsd legitimately
        // imports xml.xsd, ddi-xhtml11.xsd, dcterms.xsd (ACCESS_EXTERNAL_SCHEMA), and the
        // XHTML sub-schemas reference DTD entity files like xhtml-lat1.ent (ACCESS_EXTERNAL_DTD).
        // Network access is still blocked; only local file:// URIs are permitted here.
        // XXE protection is enforced on each Validator instance below (which validates untrusted XML).
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "file");
        factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "file");
        this.schema = factory.newSchema(xsdPath.toFile());
        log.info("XSD schema loaded successfully");
    }

    /**
     * Validate XML bytes against the compiled XSD schema.
     * Returns a list of validation errors (empty if valid).
     */
    public List<ValidationError> validate(byte[] xmlBytes) {
        List<ValidationError> errors = new ArrayList<>();
        Validator validator = schema.newValidator();
        // Disable external entity access on each validator instance too
        try {
            // Block all external entity/schema access when validating untrusted user XML.
            validator.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            validator.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        } catch (SAXException ignored) {
            // Property not supported by this parser — secure processing already set on factory
        }

        validator.setErrorHandler(new org.xml.sax.ErrorHandler() {
            @Override
            public void warning(SAXParseException e) {
                // Ignore warnings
            }

            @Override
            public void error(SAXParseException e) {
                errors.add(new ValidationError(
                    "xsd",
                    "",
                    "line " + e.getLineNumber() + ", column " + e.getColumnNumber(),
                    e.getMessage()
                ));
            }

            @Override
            public void fatalError(SAXParseException e) {
                errors.add(new ValidationError(
                    "xsd",
                    "",
                    "line " + e.getLineNumber() + ", column " + e.getColumnNumber(),
                    e.getMessage()
                ));
            }
        });

        try {
            validator.validate(new StreamSource(new ByteArrayInputStream(xmlBytes)));
        } catch (Exception e) {
            if (errors.isEmpty()) {
                errors.add(new ValidationError("xsd", "", "", e.getMessage()));
            }
        }

        return errors;
    }
}
