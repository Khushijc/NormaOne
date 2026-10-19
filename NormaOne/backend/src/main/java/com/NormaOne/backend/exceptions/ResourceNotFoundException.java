package com.NormaOne.backend.exceptions;

/**
 * 404. Also used for records outside the caller's scope (e.g. another tenant's user), so the
 * response does not reveal whether the record exists.
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
