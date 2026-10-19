package com.NormaOne.backend.security;

import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;

import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.config.NormaOneProperties;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * The browser session: Cognito tokens in HttpOnly cookies, written and cleared only by the backend.
 *
 * TWO COOKIES, EACH SENT ONLY WHERE IT IS NEEDED:
 * <ul>
 *   <li>{@value #SESSION_COOKIE} — the Cognito ID token, path /api. It authenticates every API
 *       request (CookieBearerTokenResolver). The ID token rather than the access token because it is
 *       the one this backend already prefers: it carries the verified email that onboarding and
 *       invitation linking read.</li>
 *   <li>{@value #REFRESH_COOKIE} — the Cognito refresh token, path /api/auth, so the browser sends it
 *       only to /api/auth/refresh and /api/auth/logout (and the other auth endpoints, which ignore it)
 *       and never to the rest of the API.</li>
 * </ul>
 * The access token is not stored: nothing on the server uses it, and revoking the refresh token at
 * logout revokes the access tokens issued with it.
 *
 * Every cookie is HttpOnly (no script can read it), SameSite=Strict by default (no other site's page
 * can make the browser send it), and Secure whenever the request arrived over HTTPS. Values are never
 * logged.
 */
@Component
public class AuthCookies {

    public static final String SESSION_COOKIE = "NORMAONE_SESSION";
    public static final String REFRESH_COOKIE = "NORMAONE_REFRESH";
    /**
     * Cognito's NEW_PASSWORD_REQUIRED session, between a temporary-password login and the permanent
     * password. Path /api/auth and a few minutes' life: it is not a session for the API — no request
     * outside /api/auth ever carries it, and the resource server never reads it.
     */
    public static final String CHALLENGE_COOKIE = "NORMAONE_CHALLENGE";
    public static final String SESSION_PATH = "/api";
    public static final String REFRESH_PATH = "/api/auth";

    private final NormaOneProperties.Cookies settings;

    public AuthCookies(NormaOneProperties properties) {
        this.settings = properties.getAuth().getCookies();
    }

    /** Sets the session cookie, and the refresh cookie when Cognito issued a refresh token. */
    public void write(HttpServletRequest request, HttpServletResponse response, String idToken, Integer expiresInSeconds,
            String refreshToken) {
        long sessionSeconds = expiresInSeconds != null && expiresInSeconds > 0 ? expiresInSeconds : 3600;
        add(response, cookie(request, SESSION_COOKIE, idToken, SESSION_PATH, Duration.ofSeconds(sessionSeconds)));
        if (refreshToken != null && !refreshToken.isBlank()) {
            add(response, cookie(request, REFRESH_COOKIE, refreshToken, REFRESH_PATH,
                    Duration.ofDays(Math.max(settings.getRefreshTokenDays(), 1))));
        }
    }

    /** Expires every auth cookie, with the same name, path and flags they were set with. */
    public void clear(HttpServletRequest request, HttpServletResponse response) {
        add(response, cookie(request, SESSION_COOKIE, "", SESSION_PATH, Duration.ZERO));
        add(response, cookie(request, REFRESH_COOKIE, "", REFRESH_PATH, Duration.ZERO));
        clearChallenge(request, response);
    }

    /**
     * Holds a NEW_PASSWORD_REQUIRED challenge session. Any earlier session is cleared at the same time:
     * somebody is signing in as an account that has no session yet, and the browser must not stay
     * signed in as whoever used it before.
     */
    public void writeChallenge(HttpServletRequest request, HttpServletResponse response, String challengeSession) {
        add(response, cookie(request, SESSION_COOKIE, "", SESSION_PATH, Duration.ZERO));
        add(response, cookie(request, REFRESH_COOKIE, "", REFRESH_PATH, Duration.ZERO));
        add(response, cookie(request, CHALLENGE_COOKIE, challengeSession, REFRESH_PATH,
                Duration.ofSeconds(Math.max(settings.getChallengeSeconds(), 30))));
    }

    public void clearChallenge(HttpServletRequest request, HttpServletResponse response) {
        add(response, cookie(request, CHALLENGE_COOKIE, "", REFRESH_PATH, Duration.ZERO));
    }

    public static Optional<String> read(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        return Arrays.stream(cookies)
                .filter(c -> name.equals(c.getName()) && c.getValue() != null && !c.getValue().isBlank())
                .map(Cookie::getValue)
                .findFirst();
    }

    /** Whether the request carries either session cookie — i.e. whether the browser is authenticating it. */
    public static boolean present(HttpServletRequest request) {
        return read(request, SESSION_COOKIE).isPresent() || read(request, REFRESH_COOKIE).isPresent();
    }

    private ResponseCookie cookie(HttpServletRequest request, String name, String value, String path, Duration maxAge) {
        return ResponseCookie.from(name, value)
                .httpOnly(true)
                .secure(secure(request))
                .sameSite(settings.getSameSite())
                .path(path)
                .maxAge(maxAge)
                .build();
    }

    private boolean secure(HttpServletRequest request) {
        return switch (settings.getSecure()) {
            case ALWAYS -> true;
            case NEVER -> false;
            case AUTO -> request.isSecure() || "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"));
        };
    }

    private static void add(HttpServletResponse response, ResponseCookie cookie) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
