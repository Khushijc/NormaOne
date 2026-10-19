package com.NormaOne.backend.exceptions;

/**
 * 503: the default package is not configured or not active, so a tenant cannot be provisioned.
 */
public class PackageUnavailableException extends RuntimeException {

    public PackageUnavailableException(String message) {
        super(message);
    }
}
