package com.NormaOne.backend.dto.admin;

/**
 * How an invitation reached the invited person, returned beside the record it created. Never holds
 * a password: the temporary password is generated and emailed by Cognito and never seen here.
 *
 * {@code delivery}:
 * <ul>
 *   <li>TEMPORARY_PASSWORD — Cognito created the account and emailed a temporary password; the
 *       first sign-in must set a permanent one.</li>
 *   <li>EXISTING_ACCOUNT — the email already has a Cognito account with its own password; no email
 *       was sent, and the invitation links when that account next signs in.</li>
 *   <li>SELF_REGISTRATION — temporary-password invitations are switched off; the person registers
 *       with this email themselves.</li>
 * </ul>
 */
public record InvitationInfo(String delivery, boolean emailSent, String message) {

    public static final String TEMPORARY_PASSWORD = "TEMPORARY_PASSWORD";
    public static final String EXISTING_ACCOUNT = "EXISTING_ACCOUNT";
    public static final String SELF_REGISTRATION = "SELF_REGISTRATION";
}
