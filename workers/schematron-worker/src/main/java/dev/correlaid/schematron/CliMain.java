package dev.correlaid.schematron;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

/**
 * One-shot CLI mode for the schematron-worker. No NATS dependency.
 *
 * Usage:
 *   java -cp worker.jar dev.correlaid.schematron.CliMain \
 *     --xsd  ddi-validation/xsd/codebook.xsd \
 *     --sch  ddi-validation/schematron/ddi_custom_rules.sch \
 *     --xml  registry/entities/select_one/ddi.xml
 *
 * Exit codes:
 *   0  valid (both XSD + schematron pass, or only one ran and passed)
 *   1  validation failures (errors written to stdout as JSON)
 *   2  bad arguments / IO error
 *
 * Output (stdout): pretty-printed JSON of ValidationResponse-shape:
 *   {"valid": true|false, "errors": [...]}
 */
public class CliMain {
    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();

    public static void main(String[] args) {
        Path xsdPath = null;
        Path schPath = null;
        Path xmlPath = null;

        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--xsd" -> xsdPath = Paths.get(args[++i]);
                case "--sch", "--schematron" -> schPath = Paths.get(args[++i]);
                case "--xml" -> xmlPath = Paths.get(args[++i]);
                case "-h", "--help" -> { printUsage(); System.exit(0); }
                default -> {
                    System.err.println("unknown argument: " + args[i]);
                    printUsage();
                    System.exit(2);
                }
            }
        }

        if (xmlPath == null) {
            System.err.println("missing required --xml");
            printUsage();
            System.exit(2);
        }
        if (xsdPath == null && schPath == null) {
            System.err.println("at least one of --xsd or --sch is required");
            printUsage();
            System.exit(2);
        }

        try {
            byte[] xmlBytes = Files.readAllBytes(xmlPath);

            java.util.List<ValidationError> allErrors = new java.util.ArrayList<>();
            if (xsdPath != null) {
                XsdValidator xsd = new XsdValidator(xsdPath);
                allErrors.addAll(xsd.validate(xmlBytes));
            }
            // Schematron only runs if XSD passes (matches worker behavior).
            if (schPath != null && allErrors.isEmpty()) {
                SchematronValidator sch = new SchematronValidator(schPath);
                allErrors.addAll(sch.validate(xmlBytes));
            }

            ValidationResponse resp = new ValidationResponse("cli", allErrors.isEmpty(), allErrors);
            System.out.println(gson.toJson(resp));
            System.exit(allErrors.isEmpty() ? 0 : 1);
        } catch (Exception e) {
            System.err.println("validator error: " + e.getMessage());
            e.printStackTrace(System.err);
            System.exit(2);
        }
    }

    private static void printUsage() {
        System.err.println("""
            Usage:
              java -cp worker.jar dev.correlaid.schematron.CliMain \\
                --xsd PATH  --sch PATH  --xml PATH

            At least one of --xsd / --sch must be provided. --xml is required.
            Exit 0 on valid, 1 on validation errors, 2 on bad args / IO error.
            """);
    }
}
