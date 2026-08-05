package dev.correlaid.schematron;

import net.sf.saxon.TransformerFactoryImpl;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.*;
import javax.xml.transform.stream.StreamResult;
import javax.xml.transform.stream.StreamSource;
import java.io.ByteArrayInputStream;
import java.io.StringReader;
import java.io.StringWriter;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Validates XML documents against a Schematron schema using SchXslt2 + Saxon.
 *
 * On construction, compiles the .sch file into a cached XSLT stylesheet.
 * On each validate() call, applies the stylesheet and parses the SVRL output.
 */
public class SchematronValidator {
    private static final Logger log = LoggerFactory.getLogger(SchematronValidator.class);
    private static final String SVRL_NS = "http://purl.oclc.org/dsdl/svrl";

    private final Templates compiledSchematron;

    public SchematronValidator(Path schematronPath) throws Exception {
        log.info("Compiling Schematron: {}", schematronPath);

        // Use Saxon as the XSLT 3.0 processor
        TransformerFactory factory = new TransformerFactoryImpl();
        // Disable external entity/DTD access to prevent XXE attacks
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");

        // Load SchXslt2's transpilation stylesheet from classpath
        Source transpileXsl = new StreamSource(
            getClass().getResourceAsStream("/content/transpile.xsl")
        );
        if (transpileXsl == null) {
            throw new IllegalStateException("SchXslt2 transpile.xsl not found on classpath");
        }

        // Step 1: Compile the transpiler itself
        Templates transpiler = factory.newTemplates(transpileXsl);

        // Step 2: Apply transpiler to .sch file -> produces XSLT stylesheet
        Transformer compileTransformer = transpiler.newTransformer();
        Source schSource = new StreamSource(schematronPath.toFile());
        StringWriter xsltWriter = new StringWriter();
        compileTransformer.transform(schSource, new StreamResult(xsltWriter));

        String compiledXslt = xsltWriter.toString();
        log.debug("Compiled Schematron XSLT:\n{}", compiledXslt);

        // Step 3: Compile the resulting XSLT for reuse (thread-safe)
        this.compiledSchematron = factory.newTemplates(
            new StreamSource(new StringReader(compiledXslt))
        );

        log.info("Schematron compiled successfully");
    }

    /**
     * Validate XML bytes against the compiled Schematron rules.
     * Returns a list of validation errors (empty if valid).
     */
    public List<ValidationError> validate(byte[] xmlBytes) throws Exception {
        // Apply compiled Schematron XSLT to the XML document
        Transformer transformer = compiledSchematron.newTransformer();
        Source xmlSource = new StreamSource(new ByteArrayInputStream(xmlBytes));
        StringWriter svrlWriter = new StringWriter();
        transformer.transform(xmlSource, new StreamResult(svrlWriter));

        return parseSvrl(svrlWriter.toString());
    }

    /**
     * Parse SVRL (Schematron Validation Report Language) output
     * and extract failed assertions.
     */
    private List<ValidationError> parseSvrl(String svrl) throws Exception {
        List<ValidationError> errors = new ArrayList<>();

        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        // Disable DTDs and external entities to prevent XXE in SVRL output parsing
        dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
        dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        dbf.setExpandEntityReferences(false);
        Document doc = dbf.newDocumentBuilder().parse(
            new ByteArrayInputStream(svrl.getBytes("UTF-8"))
        );

        NodeList failures = doc.getElementsByTagNameNS(SVRL_NS, "failed-assert");
        for (int i = 0; i < failures.getLength(); i++) {
            Element fa = (Element) failures.item(i);
            String location = fa.getAttribute("location");
            String test = fa.getAttribute("test");

            NodeList textNodes = fa.getElementsByTagNameNS(SVRL_NS, "text");
            String message = textNodes.getLength() > 0
                ? textNodes.item(0).getTextContent().trim() : "";

            errors.add(new ValidationError("schematron", test, location, message));
        }

        return errors;
    }
}
