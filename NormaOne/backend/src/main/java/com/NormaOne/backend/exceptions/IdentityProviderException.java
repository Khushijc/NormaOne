package com.NormaOne.backend.exceptions;

/**
 * Cognito could not carry out an account change that must happen there first (re-enabling a disabled
 * account before it is made active again). Nothing was changed in the application. Answered with
 * 502: the request was valid, the identity provider failed it.
 */
public class IdentityProviderException extends RuntimeException {
    public IdentityProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
