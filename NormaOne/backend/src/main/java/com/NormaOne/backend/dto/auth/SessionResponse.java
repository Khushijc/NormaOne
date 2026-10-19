package com.NormaOne.backend.dto.auth;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The state of the browser's cookie session, without any token in it.
 *
 * {@code authenticated} is whether the session cookie holds a token the backend accepts right now.
 * {@code refreshAvailable} is whether a refresh cookie is present, so an expired session can be
 * renewed with POST /api/auth/refresh. {@code reason} explains a false {@code authenticated}:
 * NO_SESSION, INVALID_OR_EXPIRED, LOGGED_OUT.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SessionResponse(
        boolean authenticated,
        String email,
        String tokenUse,
        Instant expiresAt,
        boolean refreshAvailable,
        String reason
) {}
