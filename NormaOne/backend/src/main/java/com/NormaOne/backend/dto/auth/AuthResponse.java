package com.NormaOne.backend.dto.auth;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The answer to a login (or verify-email with a password).
 *
 * For a browser — the default — the tokens are NOT in it: they are set as HttpOnly cookies and
 * {@code tokenType} is "Cookie". A client that sends {@code X-Token-Delivery: body} (Postman, curl,
 * another service) receives them here instead, with {@code tokenType} "Bearer", and gets no cookies.
 *
 * FIRST LOGIN OF AN INVITED ACCOUNT: a correct temporary password answers with
 * {@code challenge: "NEW_PASSWORD_REQUIRED"} and no tokens and no session — nothing is authenticated
 * yet. The browser receives the challenge session in an HttpOnly cookie; a body-delivery client in
 * {@code challengeSession}. Either completes it with POST /api/auth/new-password.
 *
 * {@code requiresTenantSetup} is kept for existing clients; the source of truth for onboarding is
 * GET /api/users/me.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuthResponse(
        String accessToken,
        String idToken,
        String refreshToken,
        String tokenType,
        boolean requiresTenantSetup,
        Instant expiresAt,
        String challenge,
        String challengeSession
) {
    public static final String NEW_PASSWORD_REQUIRED = "NEW_PASSWORD_REQUIRED";

    public AuthResponse(String accessToken, String idToken, String refreshToken, String tokenType,
            boolean requiresTenantSetup, Instant expiresAt) {
        this(accessToken, idToken, refreshToken, tokenType, requiresTenantSetup, expiresAt, null, null);
    }
}
