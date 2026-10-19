package com.NormaOne.backend.security;

import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Where the resource server finds the token: the Authorization header first, then the session cookie.
 *
 * THE HEADER WINS, so API clients that send {@code Authorization: Bearer …} (Postman, curl, other
 * services, the integration tests) behave exactly as before, whatever cookies they happen to carry.
 *
 * THE COOKIE IS IGNORED ON /api/auth/**. Those paths are public (register, verify, login, refresh,
 * logout, session), and a token the resource server resolves is a token it validates: an expired
 * session cookie would otherwise turn a fresh login into a 401. /api/auth/session reads and checks
 * the cookie itself, without failing the request.
 */
public class CookieBearerTokenResolver implements BearerTokenResolver {

    private final DefaultBearerTokenResolver header = new DefaultBearerTokenResolver();

    @Override
    public String resolve(HttpServletRequest request) {
        String fromHeader = header.resolve(request);
        if (fromHeader != null) {
            return fromHeader;
        }
        if (isPublicAuthPath(request)) {
            return null;
        }
        return AuthCookies.read(request, AuthCookies.SESSION_COOKIE).orElse(null);
    }

    static boolean isPublicAuthPath(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return path.equals("/api/auth") || path.startsWith("/api/auth/");
    }
}
