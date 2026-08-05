package dev.correlaid.schematron;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class ValidationResponse {
    @SerializedName("request_id")
    public String requestId;

    public boolean valid;
    public List<ValidationError> errors;

    public ValidationResponse(String requestId, boolean valid, List<ValidationError> errors) {
        this.requestId = requestId;
        this.valid = valid;
        this.errors = errors;
    }
}
