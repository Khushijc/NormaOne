package com.NormaOne.backend.exceptions;

public class DuplicateSubdomainException extends RuntimeException {

    public DuplicateSubdomainException(String message) {
        super(message);
    }
}
