package com.NormaOne.backend.exceptions;

/**
 * 409 for a request that conflicts with the current state (e.g. a status already set, removing
 * the last active tenant administrator, onboarding already in progress).
 */
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
