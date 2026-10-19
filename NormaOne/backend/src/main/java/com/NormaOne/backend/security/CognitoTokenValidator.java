package com.NormaOne.backend.security;

import java.util.List;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Accepts only tokens issued to this application's Cognito app client.
 *
 * The issuer check alone accepts tokens from any app client of the same user pool. Cognito access
 * tokens carry the client in {@code client_id}; ID tokens carry it in {@code aud}. Both token types
 * returned by /api/auth/login keep working.
 */
public class CognitoTokenValidator implements OAuth2TokenValidator<Jwt> {

    private static final OAuth2Error INVALID = new OAuth2Error("invalid_token",
            "The token was not issued for this application.", null);

    private final String clientId;

    public CognitoTokenValidator(String clientId) {
        this.clientId = clientId;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        String tokenUse = jwt.getClaimAsString("token_use");
        if ("access".equals(tokenUse) && clientId.equals(jwt.getClaimAsString("client_id"))) {
            return OAuth2TokenValidatorResult.success();
        }
        if ("id".equals(tokenUse)) {
            List<String> audience = jwt.getAudience();
            if (audience != null && audience.contains(clientId)) {
                return OAuth2TokenValidatorResult.success();
            }
        }
        return OAuth2TokenValidatorResult.failure(INVALID);
    }
}
