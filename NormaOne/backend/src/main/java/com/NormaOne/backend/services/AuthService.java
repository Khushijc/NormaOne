package com.NormaOne.backend.services;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.dto.auth.LoginRequest;
import com.NormaOne.backend.dto.auth.RegisterRequest;
import com.NormaOne.backend.dto.auth.ResendCodeRequest;
import com.NormaOne.backend.dto.auth.VerifyEmailRequest;
import com.NormaOne.backend.exceptions.UserAlreadyExistsException;

import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminGetUserResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AttributeType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthFlowType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthenticationResultType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ChallengeNameType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ConfirmSignUpRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.DescribeUserPoolRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ResendConfirmationCodeRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RevokeTokenRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.SignUpRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserStatusType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UsernameExistsException;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final CognitoIdentityProviderClient cognito;
    private final String clientId;
    private final String userPoolId;

    public AuthService(
            CognitoIdentityProviderClient cognito,
            @Value("${aws.cognito.client-id}") String clientId,
            @Value("${aws.cognito.user-pool-id:#{null}}") String userPoolId) {
        this.cognito = cognito;
        this.clientId = clientId;
        this.userPoolId = userPoolId;
    }

    public String register(RegisterRequest request) {
        String email = normalizeEmail(request.email());

        SignUpRequest signUpRequest = SignUpRequest.builder()
                .clientId(clientId)
                .username(email)
                .password(request.password())
                .userAttributes(List.of(
                        AttributeType.builder()
                                .name("email")
                                .value(email)
                                .build(),
                        AttributeType.builder()
                                .name("name")
                                .value(request.name().trim())
                                .build()
                ))
                .build();

        try {
            cognito.signUp(signUpRequest);
        } catch (UsernameExistsException ex) {
            boolean isConfirmed = checkUserConfirmed(email);
            if (isConfirmed) {
                throw new UserAlreadyExistsException(
                        "An account with this email already exists and is active. Please log in.",
                        true
                );
            } else {
                throw new UserAlreadyExistsException(
                        "An account with this email already exists but has not been verified. Please verify your email with your confirmation code or request a new code.",
                        false
                );
            }
        }

        return "Registration started. Check your email for the verification code.";
    }

    public Object verifyEmail(VerifyEmailRequest request) {
        String email = normalizeEmail(request.email());

        ConfirmSignUpRequest confirmRequest = ConfirmSignUpRequest.builder()
                .clientId(clientId)
                .username(email)
                .confirmationCode(request.code().trim())
                .build();

        cognito.confirmSignUp(confirmRequest);

        // If password was supplied, attempt automatic sign-in
        if (request.password() != null && !request.password().isBlank()) {
            try {
                return authenticate(email, request.password());
            } catch (Exception ex) {
                log.warn("Email verified for {} but auto-login could not complete: {}", email, ex.getMessage());
                return Map.of(
                        "message", "Email verified successfully. Please log in with your credentials.",
                        "verified", true
                );
            }
        }

        return Map.of(
                "message", "Email verified successfully. You can now log in.",
                "verified", true
        );
    }

    public Map<String, String> resendCode(ResendCodeRequest request) {
        String email = normalizeEmail(request.email());

        ResendConfirmationCodeRequest resendRequest = ResendConfirmationCodeRequest.builder()
                .clientId(clientId)
                .username(email)
                .build();

        cognito.resendConfirmationCode(resendRequest);

        return Map.of("message", "A new verification code has been sent to your email.");
    }

    /**
     * The tokens Cognito issued, for the controller to deliver: as HttpOnly cookies to a browser, or in
     * the body to a client that asked for that. Never logged.
     */
    public record CognitoTokens(String accessToken, String idToken, String refreshToken, Integer expiresInSeconds)
            implements LoginResult {}

    /**
     * Cognito answered a correct temporary password with NEW_PASSWORD_REQUIRED: the account was created
     * by an administrator and must set a permanent password before it gets any token. {@code session} is
     * Cognito's opaque challenge session (valid for the app client's authentication-flow session
     * duration, 3 minutes by default) — not a credential for the API, and never logged.
     */
    public record NewPasswordChallenge(String session) implements LoginResult {}

    /** What a sign-in produced: tokens, or the first-login password challenge. */
    public sealed interface LoginResult permits CognitoTokens, NewPasswordChallenge {}

    /** Cognito's password policy for this user pool, for the page that asks for a new password. */
    public record PasswordPolicy(int minimumLength, boolean requireUppercase, boolean requireLowercase,
            boolean requireNumbers, boolean requireSymbols, Integer temporaryPasswordValidityDays, String source) {

        /** Cognito's defaults, shown when the pool cannot be described. */
        static PasswordPolicy cognitoDefault() {
            return new PasswordPolicy(8, true, true, true, true, 7, "DEFAULT");
        }
    }

    private volatile PasswordPolicy passwordPolicy;

    public LoginResult login(LoginRequest request) {
        return authenticate(
                normalizeEmail(request.email()),
                request.password()
        );
    }

    private LoginResult authenticate(String email, String password) {
        InitiateAuthRequest authRequest = InitiateAuthRequest.builder()
                .clientId(clientId)
                .authFlow(AuthFlowType.USER_PASSWORD_AUTH)
                .authParameters(Map.of(
                        "USERNAME", email,
                        "PASSWORD", password
                ))
                .build();

        var response = cognito.initiateAuth(authRequest);

        AuthenticationResultType result = response.authenticationResult();

        if (result == null) {
            if (ChallengeNameType.NEW_PASSWORD_REQUIRED.equals(response.challengeName())) {
                return new NewPasswordChallenge(response.session());
            }
            throw new IllegalStateException(
                    "Additional authentication is required (MFA or Cognito challenge)."
            );
        }

        return new CognitoTokens(result.accessToken(), result.idToken(), result.refreshToken(), result.expiresIn());
    }

    /**
     * Answers NEW_PASSWORD_REQUIRED with the permanent password (RespondToAuthChallenge). Cognito
     * checks the password against the pool's policy (InvalidPasswordException) and the session's
     * validity (NotAuthorizedException), and on success issues the account's first tokens.
     */
    public CognitoTokens completeNewPassword(String email, String newPassword, String session) {
        var response = cognito.respondToAuthChallenge(RespondToAuthChallengeRequest.builder()
                .clientId(clientId)
                .challengeName(ChallengeNameType.NEW_PASSWORD_REQUIRED)
                .session(session)
                .challengeResponses(Map.of("USERNAME", normalizeEmail(email), "NEW_PASSWORD", newPassword))
                .build());
        AuthenticationResultType result = response.authenticationResult();
        if (result == null) {
            throw new IllegalStateException("Cognito asked for a further challenge after the new password.");
        }
        return new CognitoTokens(result.accessToken(), result.idToken(), result.refreshToken(), result.expiresIn());
    }

    /**
     * The pool's password policy (DescribeUserPool), read once and kept. When the backend may not
     * describe the pool, Cognito's defaults are returned with source DEFAULT; Cognito still enforces the
     * real policy when the password is submitted.
     */
    public PasswordPolicy passwordPolicy() {
        PasswordPolicy cached = passwordPolicy;
        if (cached != null) {
            return cached;
        }
        try {
            var pool = cognito.describeUserPool(DescribeUserPoolRequest.builder().userPoolId(userPoolId).build());
            var policy = pool != null && pool.userPool() != null && pool.userPool().policies() != null
                    ? pool.userPool().policies().passwordPolicy() : null;
            if (policy == null) {
                return PasswordPolicy.cognitoDefault();
            }
            PasswordPolicy read = new PasswordPolicy(
                    policy.minimumLength() != null ? policy.minimumLength() : 8,
                    Boolean.TRUE.equals(policy.requireUppercase()), Boolean.TRUE.equals(policy.requireLowercase()),
                    Boolean.TRUE.equals(policy.requireNumbers()), Boolean.TRUE.equals(policy.requireSymbols()),
                    policy.temporaryPasswordValidityDays(), "COGNITO");
            passwordPolicy = read;
            return read;
        } catch (RuntimeException ex) {
            log.debug("DescribeUserPool not available ({}); showing Cognito's default password policy.", ex.getClass().getSimpleName());
            return PasswordPolicy.cognitoDefault();
        }
    }

    /**
     * New ID and access tokens from a refresh token (Cognito REFRESH_TOKEN_AUTH; the app client has no
     * secret, so no SECRET_HASH). Cognito returns no new refresh token unless rotation is on, so the
     * result's refreshToken may be null — the caller keeps the one it has. An expired or revoked refresh
     * token throws NotAuthorizedException.
     */
    public CognitoTokens refresh(String refreshToken) {
        var response = cognito.initiateAuth(InitiateAuthRequest.builder()
                .clientId(clientId)
                .authFlow(AuthFlowType.REFRESH_TOKEN_AUTH)
                .authParameters(Map.of("REFRESH_TOKEN", refreshToken))
                .build());
        AuthenticationResultType result = response.authenticationResult();
        if (result == null || result.idToken() == null) {
            throw new IllegalStateException("Cognito returned no tokens for the refresh.");
        }
        return new CognitoTokens(result.accessToken(), result.idToken(), result.refreshToken(), result.expiresIn());
    }

    /**
     * Revokes a refresh token at Cognito, which also invalidates the access tokens issued with it.
     * Best effort: logout clears the cookies whether or not this succeeds (it needs token revocation
     * enabled on the app client, the default for new clients).
     */
    public void revoke(String refreshToken) {
        try {
            cognito.revokeToken(RevokeTokenRequest.builder().clientId(clientId).token(refreshToken).build());
        } catch (RuntimeException ex) {
            log.warn("Refresh token revocation failed ({}); the session cookies are cleared anyway.", ex.getClass().getSimpleName());
        }
    }

    private boolean checkUserConfirmed(String email) {
        if (userPoolId != null && !userPoolId.isBlank()) {
            try {
                AdminGetUserResponse response = cognito.adminGetUser(AdminGetUserRequest.builder()
                        .userPoolId(userPoolId)
                        .username(email)
                        .build());
                return UserStatusType.CONFIRMED.equals(response.userStatus());
            } catch (Exception e) {
                log.debug("AdminGetUser check failed or not authorized: {}", e.getMessage());
            }
        }
        return false;
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}