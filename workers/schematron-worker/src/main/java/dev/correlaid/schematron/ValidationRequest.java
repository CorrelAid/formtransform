package dev.correlaid.schematron;

import com.google.gson.annotations.SerializedName;

public class ValidationRequest {
    @SerializedName("request_id")
    public String requestId;

    public String xml; // base64 encoded
}
