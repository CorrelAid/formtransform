package dev.correlaid.schematron;

import io.nats.client.*;
import com.google.gson.Gson;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Paths;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CountDownLatch;

public class SchematronWorker {
    private static final Logger log = LoggerFactory.getLogger(SchematronWorker.class);
    private static final String SUBJECT = "schematron.validate";
    private static final Gson gson = new Gson();

    public static void main(String[] args) throws Exception {
        String natsUrl = System.getenv().getOrDefault("NATS_URL", "nats://localhost:4222");
        String schPath = System.getenv().getOrDefault("SCHEMATRON_PATH", "/app/schematron/ddi_custom_rules.sch");
        String xsdPath = System.getenv().getOrDefault("XSD_PATH", "/app/xml/codebook.xsd");

        log.info("Initializing XSD validator from {}", xsdPath);
        XsdValidator xsdValidator = new XsdValidator(Paths.get(xsdPath));

        log.info("Initializing Schematron validator from {}", schPath);
        SchematronValidator schValidator = new SchematronValidator(Paths.get(schPath));

        String natsToken = System.getenv("NATS_TOKEN");

        Options.Builder optBuilder = new Options.Builder()
            .server(natsUrl)
            .reconnectWait(Duration.ofSeconds(2))
            .maxReconnects(-1)
            .connectionListener((conn, type) ->
                log.info("NATS connection event: {}", type));
        if (natsToken != null && !natsToken.isBlank()) {
            optBuilder.token(natsToken.toCharArray());
        } else {
            log.warn("NATS_TOKEN not set; connecting without authentication");
        }
        Options options = optBuilder.build();

        Connection nc = Nats.connect(options);
        log.info("Connected to NATS at {}", natsUrl);

        Dispatcher dispatcher = nc.createDispatcher(msg -> {
            String requestId = "";
            try {
                ValidationRequest req = gson.fromJson(
                    new String(msg.getData()), ValidationRequest.class
                );
                requestId = req.requestId;
                byte[] xmlBytes = Base64.getDecoder().decode(req.xml);

                // 1. XSD validation first
                List<ValidationError> errors = xsdValidator.validate(xmlBytes);
                if (!errors.isEmpty()) {
                    ValidationResponse resp = new ValidationResponse(req.requestId, false, errors);
                    nc.publish(msg.getReplyTo(), gson.toJson(resp).getBytes());
                    log.info("XSD validation failed for request {}: {} errors", req.requestId, errors.size());
                    return;
                }

                // 2. Schematron validation
                errors = schValidator.validate(xmlBytes);
                ValidationResponse resp = new ValidationResponse(
                    req.requestId, errors.isEmpty(), errors
                );

                nc.publish(msg.getReplyTo(), gson.toJson(resp).getBytes());
                log.info("Validated request {}: valid={}, errors={}", req.requestId, errors.isEmpty(), errors.size());
            } catch (Exception e) {
                log.error("Validation failed for request {}", requestId, e);
                ValidationResponse resp = new ValidationResponse(
                    requestId, false, List.of(new ValidationError(
                        "_internal", "", "", e.getMessage()
                    ))
                );
                nc.publish(msg.getReplyTo(), gson.toJson(resp).getBytes());
            }
        });
        dispatcher.subscribe(SUBJECT);
        log.info("Subscribed to {}, waiting for requests...", SUBJECT);

        new CountDownLatch(1).await();
    }
}
