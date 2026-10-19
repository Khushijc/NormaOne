package com.NormaOne.backend.exceptions;

/**
 * Cognito refused to create the invited account or to send its invitation email. The invitation
 * record that was about to be kept is removed before this is thrown, so a failed invitation never
 * leaves a user waiting for an email that was not sent. Answered with 502: the request was valid,
 * the identity provider failed it.
 */
public class InvitationDeliveryException extends RuntimeException {

    public InvitationDeliveryException(String message, Throwable cause) {
        super(message, cause);
    }
}
