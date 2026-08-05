package dev.correlaid.schematron;

public class ValidationError {
    public String rule;
    public String test;
    public String location;
    public String message;

    public ValidationError(String rule, String test, String location, String message) {
        this.rule = rule;
        this.test = test;
        this.location = location;
        this.message = message;
    }
}
