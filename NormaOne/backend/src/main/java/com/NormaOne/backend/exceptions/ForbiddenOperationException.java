package com.NormaOne.backend.exceptions;

/**
 * 403 for an operation the caller's role may never perform (e.g. assigning SUPER_ADMIN),
 * with a message that explains the rule.
 */
public class ForbiddenOperationException extends RuntimeException {

    public ForbiddenOperationException(String message) {
        super(message);
    }
}
