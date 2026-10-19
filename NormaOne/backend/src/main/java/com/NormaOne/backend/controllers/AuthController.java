package com.NormaOne.backend.controllers;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.web.bind.annotation.*;

import com.NormaOne.backend.dto.auth.AuthResponse;
import com.NormaOne.backend.dto.auth.LoginRequest;
import com.NormaOne.backend.dto.auth.NewPasswordRequest;
import com.NormaOne.backend.dto.auth.RegisterRequest;
import com.NormaOne.backend.dto.auth.ResendCodeRequest;
import com.NormaOne.backend.dto.auth.SessionResponse;
import com.NormaOne.backend.dto.auth.VerifyEmailRequest;
import com.NormaOne.backend.exceptions.ErrorResponse;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.TenantRepository;
import com.NormaOne.backend.security.AuthCookies;
import com.NormaOne.backend.services.AccountLinkService;
import com.NormaOne.backend.services.AuthService;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import software.amazon.awssdk.services.cognitoidentityprovider.model.NotAuthorizedException;

/**
 * Public authentication endpoints (permitAll in SecurityConfig).
 *
 * BROWSER SESSIONS ARE COOKIES. A successful login sets the Cognito ID token and refresh token as
 * HttpOnly cookies (AuthCookies) and returns no token in the body, so no script ever holds one.
 * A non-browser client asks for the tokens in the body with {@code X-Token-Delivery: body} and then
 * sends {@code Authorization: Bearer …} as before.
 *
 * /session, /refresh and /logout complete the cookie session: its status (never its token), renewal
 * through the existing Cognito refresh-token flow, and sign-out.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    /** Request header with which a non-browser client asks for the tokens in the response body. */
    public static final String TOKEN_DELIVERY_HEADER = "X-Token-Delivery";

    private final AuthService authService;
    private final AuthCookies cookies;
    private final JwtDecoder jwtDecoder;
    private final AccountLinkService accountLinkService;
    private final TenantRepository tenantRepository;

    public AuthController(
            AuthService authService,
            AuthCookies cookies,
            JwtDecoder jwtDecoder,
            AccountLinkService accountLinkService,
            TenantRepository tenantRepository) {
        this.authService = authService;
        this.cookies = cookies;
        this.jwtDecoder = jwtDecoder;
        this.accountLinkService = accountLinkService;
        this.tenantRepository = tenantRepository;
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(
            @Valid @RequestBody RegisterRequest request) {

        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(Map.of("message", authService.register(request)));
    }

    @PostMapping("/verify-email")
    public ResponseEntity<?> verifyEmail(
            @Valid @RequestBody VerifyEmailRequest request,
            @RequestHeader(value = TOKEN_DELIVERY_HEADER, required = false) String delivery,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {

        Object result = authService.verifyEmail(request);
        if (result instanceof AuthService.LoginResult login) {
            return ResponseEntity.ok(deliver(login, delivery, httpRequest, httpResponse));
        }
        return ResponseEntity.ok(result);
    }

    @PostMapping("/resend-code")
    public ResponseEntity<?> resendCode(
            @Valid @RequestBody ResendCodeRequest request) {

        return ResponseEntity.ok(authService.resendCode(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
            @Valid @RequestBody LoginRequest request,
            @RequestHeader(value = TOKEN_DELIVERY_HEADER, required = false) String delivery,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {

        return ResponseEntity.ok(deliver(authService.login(request), delivery, httpRequest, httpResponse));
    }

    /**
     * Completes an invited account's first login: the permanent password answers Cognito's
     * NEW_PASSWORD_REQUIRED challenge, and only then is the session set — exactly as a normal login
     * sets it. The challenge session comes from the HttpOnly challenge cookie (or, for a body-delivery
     * client, the request). Errors: 400 when Cognito's password policy refuses the password (its own
     * message), 401 when the challenge is missing or expired — sign in again with the temporary password.
     */
    @PostMapping("/new-password")
    public ResponseEntity<?> newPassword(
            @Valid @RequestBody NewPasswordRequest request,
            @RequestHeader(value = TOKEN_DELIVERY_HEADER, required = false) String delivery,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse) {

        String session = AuthCookies.read(httpRequest, AuthCookies.CHALLENGE_COOKIE)
                .orElse(request.session() != null && !request.session().isBlank() ? request.session() : null);
        if (session == null) {
            return unauthorized("No password-change step is in progress, or it has expired. Sign in again with the temporary password.", httpRequest);
        }
        try {
            AuthService.CognitoTokens tokens = authService.completeNewPassword(request.email(), request.newPassword(), session);
            cookies.clearChallenge(httpRequest, httpResponse);
            return ResponseEntity.ok(deliver(tokens, delivery, httpRequest, httpResponse));
        } catch (NotAuthorizedException ex) {
            cookies.clearChallenge(httpRequest, httpResponse);
            return unauthorized("The password-change step has expired or does not match this email. Sign in again with the temporary password.", httpRequest);
        }
    }

    /**
     * The user pool's password policy, for the page that asks for a new password: from Cognito
     * (DescribeUserPool) when the backend may read it, otherwise Cognito's defaults (source DEFAULT).
     */
    @GetMapping("/password-policy")
    public AuthService.PasswordPolicy passwordPolicy() {
        return authService.passwordPolicy();
    }

    /**
     * The cookie session's state. Always 200: an absent, expired or invalid session is an answer, not
     * an error. The token itself is never returned.
     */
    @GetMapping("/session")
    public SessionResponse session(HttpServletRequest request) {
        boolean refreshAvailable = AuthCookies.read(request, AuthCookies.REFRESH_COOKIE).isPresent();
        Optional<String> token = AuthCookies.read(request, AuthCookies.SESSION_COOKIE);
        if (token.isEmpty()) {
            return new SessionResponse(false, null, null, null, refreshAvailable, "NO_SESSION");
        }
        try {
            Jwt jwt = jwtDecoder.decode(token.get());
            return new SessionResponse(true, jwt.getClaimAsString("email"), jwt.getClaimAsString("token_use"),
                    jwt.getExpiresAt(), refreshAvailable, null);
        } catch (JwtException ex) {
            return new SessionResponse(false, null, null, null, refreshAvailable, "INVALID_OR_EXPIRED");
        }
    }

    /**
     * Renews the session cookie from the refresh cookie. When the refresh token is missing, expired or
     * revoked, both cookies are cleared and the answer is 401: the browser must sign in again.
     */
    @PostMapping("/refresh")
    public ResponseEntity<?> refresh(HttpServletRequest request, HttpServletResponse response) {
        Optional<String> refreshToken = AuthCookies.read(request, AuthCookies.REFRESH_COOKIE);
        if (refreshToken.isEmpty()) {
            cookies.clear(request, response);
            return unauthorized("No refresh token: sign in again.", request);
        }
        try {
            AuthService.CognitoTokens tokens = authService.refresh(refreshToken.get());
            cookies.write(request, response, tokens.idToken(), tokens.expiresInSeconds(), tokens.refreshToken());
            return ResponseEntity.ok(new SessionResponse(true, null, "id", expiry(tokens), true, null));
        } catch (NotAuthorizedException ex) {
            cookies.clear(request, response);
            return unauthorized("The session has expired or was revoked: sign in again.", request);
        }
    }

    /** Revokes the refresh token at Cognito (best effort) and clears both cookies. Safe to call when signed out. */
    @PostMapping("/logout")
    public SessionResponse logout(HttpServletRequest request, HttpServletResponse response) {
        AuthCookies.read(request, AuthCookies.REFRESH_COOKIE).ifPresent(authService::revoke);
        cookies.clear(request, response);
        return new SessionResponse(false, null, null, null, false, "LOGGED_OUT");
    }

    /**
     * Cookies by default; the body only for a client that asked for it. A first-login challenge sets
     * no session at all: only the challenge, which authenticates nothing.
     */
    private AuthResponse deliver(AuthService.LoginResult result, String delivery, HttpServletRequest request,
            HttpServletResponse response) {
        boolean body = "body".equalsIgnoreCase(delivery);
        if (result instanceof AuthService.NewPasswordChallenge challenge) {
            if (!body) {
                cookies.writeChallenge(request, response, challenge.session());
            }
            return new AuthResponse(null, null, null, null, true, null, AuthResponse.NEW_PASSWORD_REQUIRED,
                    body ? challenge.session() : null);
        }
        AuthService.CognitoTokens tokens = (AuthService.CognitoTokens) result;
        boolean requiresTenantSetup = checkRequiresTenantSetup(tokens);
        if (body) {
            return new AuthResponse(tokens.accessToken(), tokens.idToken(), tokens.refreshToken(), "Bearer", requiresTenantSetup, expiry(tokens));
        }
        cookies.write(request, response, tokens.idToken(), tokens.expiresInSeconds(), tokens.refreshToken());
        return new AuthResponse(null, null, null, "Cookie", requiresTenantSetup, expiry(tokens));
    }

    private boolean checkRequiresTenantSetup(AuthService.CognitoTokens tokens) {
        if (tokens == null || tokens.idToken() == null) {
            return true;
        }
        try {
            Jwt jwt = jwtDecoder.decode(tokens.idToken());
            Optional<user> userOpt = accountLinkService.findOrLink(jwt);
            if (userOpt.isPresent()) {
                user u = userOpt.get();
                boolean platform = u.getTenantId() == null || u.getTenantId().isBlank();
                if (platform) {
                    return false;
                }
                Tenant tenant = tenantRepository.findById(u.getTenantId()).orElse(null);
                return tenant == null || tenant.getStatus() != TenantStatus.ACTIVE;
            }
        } catch (Exception ex) {
            // fallback to true if token cannot be decoded or lookup fails
        }
        return true;
    }

    private static Instant expiry(AuthService.CognitoTokens tokens) {
        return Instant.now().plusSeconds(tokens.expiresInSeconds() != null ? tokens.expiresInSeconds() : 3600);
    }

    private static ResponseEntity<ErrorResponse> unauthorized(String message, HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(new ErrorResponse(401, HttpStatus.UNAUTHORIZED.getReasonPhrase(), message, request.getRequestURI()));
    }
}
