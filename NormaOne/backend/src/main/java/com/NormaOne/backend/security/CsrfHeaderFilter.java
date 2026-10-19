package com.NormaOne.backend.security;

import java.io.IOException;
import java.util.Set;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * CSRF protection for cookie sessions: a state-changing request that could be riding on the
 * browser's cookies must carry {@value #HEADER}.
 *
 * WHY A HEADER. A page on another origin cannot add a custom header to a cross-origin request
 * without a CORS preflight, and this API approves none (or only the configured origins). So the
 * header proves the request came from a page allowed to call the API. It is the second layer:
 * SameSite=Strict already stops the browser sending the session cookie on any request another site
 * starts.
 *
 * WHICH REQUESTS. POST, PUT, PATCH and DELETE that have no Authorization header and either carry a
 * session cookie or go to /api/auth/** (so a forged login cannot sign the browser into someone else's
 * account). A request with an Authorization header is not using cookies, and is not checked — API
 * clients are unaffected. Reads are never checked: GET changes nothing.
 */
public class CsrfHeaderFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Requested-With";

    private static final Set<String> SAFE = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean unsafe = !SAFE.contains(request.getMethod());
        boolean usesCookies = request.getHeader(HttpHeaders.AUTHORIZATION) == null
                && (AuthCookies.present(request) || CookieBearerTokenResolver.isPublicAuthPath(request));
        String marker = request.getHeader(HEADER);
        if (unsafe && usesCookies && (marker == null || marker.isBlank())) {
            JsonSecurityErrorHandlers.write(response, HttpStatus.FORBIDDEN,
                    "Missing " + HEADER + " header: a browser request that changes something must come from the NormaOne app.",
                    request);
            return;
        }
        chain.doFilter(request, response);
    }
}
