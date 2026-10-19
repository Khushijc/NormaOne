package com.NormaOne.backend.services;

import java.util.Locale;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserStatusType;

/**
 * Reads identity attributes (email, name, email_verified) for the caller.
 *
 * ID tokens carry these claims; access tokens do not, so the values are then read from Cognito
 * with AdminGetUser (requires AWS credentials with cognito-idp:AdminGetUser). If neither source is
 * available the values are null and callers must not treat the email as verified.
 */
@Component
public class CognitoIdentityLookup {

    private static final Logger log = LoggerFactory.getLogger(CognitoIdentityLookup.class);

    private final CognitoIdentityProviderClient cognito;
    private final String userPoolId;

    public CognitoIdentityLookup(
            CognitoIdentityProviderClient cognito,
            @Value("${aws.cognito.user-pool-id:#{null}}") String userPoolId) {
        this.cognito = cognito;
        this.userPoolId = userPoolId;
    }

    /** Attributes of a Cognito account. {@code emailVerified} is null when unknown. */
    public record Identity(String sub, String email, String name, Boolean emailVerified, Boolean confirmed) {

        /** True only when the email is known to be verified. */
        public boolean hasVerifiedEmail() {
            return email != null && !email.isBlank() && Boolean.TRUE.equals(emailVerified);
        }
    }

    public Identity forJwt(Jwt jwt) {
        String sub = jwt.getSubject();
        String email = jwt.getClaimAsString("email");
        String name = jwt.getClaimAsString("name");
        Boolean verified = jwt.hasClaim("email_verified") ? Boolean.valueOf(String.valueOf(jwt.getClaims().get("email_verified"))) : null;
        Boolean confirmed = null;
        if (email == null || email.isBlank() || name == null || name.isBlank() || verified == null) {
            Optional<Identity> fromCognito = adminGetUser(sub);
            if (fromCognito.isPresent()) {
                Identity c = fromCognito.get();
                email = blank(email) ? c.email() : email;
                name = blank(name) ? c.name() : name;
                verified = verified == null ? c.emailVerified() : verified;
                confirmed = c.confirmed();
            }
        }
        return new Identity(sub, normalizeEmail(email), name != null ? name.trim() : null, verified, confirmed);
    }

    /** Looks up a Cognito account by username or sub; empty if not configured, not found or not permitted. */
    public Optional<Identity> adminGetUser(String username) {
        if (userPoolId == null || userPoolId.isBlank() || username == null || username.isBlank()) {
            return Optional.empty();
        }
        try {
            AdminGetUserResponse response = cognito.adminGetUser(AdminGetUserRequest.builder()
                    .userPoolId(userPoolId)
                    .username(username)
                    .build());
            if (response == null) {
                return Optional.empty();
            }
            String sub = null;
            String email = null;
            String name = null;
            Boolean verified = null;
            if (response.userAttributes() != null) {
                for (AttributeType attr : response.userAttributes()) {
                    switch (attr.name().toLowerCase(Locale.ROOT)) {
                        case "sub" -> sub = attr.value();
                        case "email" -> email = attr.value();
                        case "name" -> name = attr.value();
                        case "email_verified" -> verified = Boolean.valueOf(attr.value());
                        default -> { }
                    }
                }
            }
            return Optional.of(new Identity(sub, normalizeEmail(email), name, verified,
                    UserStatusType.CONFIRMED.equals(response.userStatus())));
        } catch (RuntimeException ex) {
            log.debug("Could not retrieve Cognito attributes for {}: {}", username, ex.getMessage());
            return Optional.empty();
        }
    }

    public static String normalizeEmail(String email) {
        return email == null || email.isBlank() ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
