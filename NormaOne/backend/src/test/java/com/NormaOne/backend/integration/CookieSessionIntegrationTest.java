package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.security.AuthCookies;

import jakarta.servlet.http.Cookie;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthFlowType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthenticationResultType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.NotAuthorizedException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RevokeTokenRequest;

/**
 * Browser sessions: Cognito tokens in HttpOnly cookies set by the backend, CSRF protection for
 * requests that ride on them, refresh, logout, and the status endpoint — and that Bearer-header
 * clients and every authorization rule behave as before.
 *
 * Unlike the other integration tests (which put an authentication straight into the security
 * context), these send real token strings, so the JwtDecoder is mocked: "good" tokens decode to an
 * ID token for a known sub, anything else fails the way an expired or forged token does.
 */
class CookieSessionIntegrationTest extends IntegrationTestBase {

    private static final String ADMIN_TOKEN = "id-token-admin";
    private static final String USER_TOKEN = "id-token-user";
    private static final String CSRF = "X-Requested-With";

    @MockitoBean
    private JwtDecoder jwtDecoder;

    private String userId;

    @BeforeEach
    void accounts() throws Exception {
        when(jwtDecoder.decode(any())).thenAnswer(call -> switch ((String) call.getArgument(0)) {
            case ADMIN_TOKEN -> idToken(ADMIN_TOKEN, "sub-admin", "admin@a.test");
            case USER_TOKEN -> idToken(USER_TOKEN, "sub-user", "user@a.test");
            default -> throw new BadJwtException("expired or invalid");
        });
        onboard("sub-admin", "admin@a.test", "alpha");
        String body = mvc.perform(post("/api/tenant/users").with(as("sub-admin")).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Uma\",\"email\":\"user@a.test\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        userId = json(body, "$.id");
        mvc.perform(get("/api/users/me").with(asVerified("sub-user", "user@a.test", "Uma")))
                .andExpect(jsonPath("$.effectiveRole").value("USER"));
    }

    private static Jwt idToken(String value, String sub, String email) {
        return Jwt.withTokenValue(value).header("alg", "RS256").subject(sub)
                .claim("token_use", "id").claim("email", email).claim("email_verified", true)
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(3600)).build();
    }

    private void cognitoIssues(String idToken, String refreshToken) {
        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenReturn(InitiateAuthResponse.builder()
                .authenticationResult(AuthenticationResultType.builder()
                        .idToken(idToken).accessToken("access-token").refreshToken(refreshToken)
                        .tokenType("Bearer").expiresIn(3600).build())
                .build());
    }

    private static MockHttpServletRequestBuilder login() {
        return post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@a.test\",\"password\":\"Secret123!\"}");
    }

    private static Cookie session(String token) {
        return new Cookie(AuthCookies.SESSION_COOKIE, token);
    }

    private static Cookie refreshCookie(String token) {
        return new Cookie(AuthCookies.REFRESH_COOKIE, token);
    }

    private static List<String> setCookies(MvcResult result) {
        return result.getResponse().getHeaders(HttpHeaders.SET_COOKIE);
    }

    // ==================== login sets HttpOnly cookies and returns no token ====================

    @Test
    void loginSetsHttpOnlyCookiesAndReturnsNoTokens() throws Exception {
        cognitoIssues(ADMIN_TOKEN, "refresh-token");

        MvcResult result = mvc.perform(login().header(CSRF, "NormaOne"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Cookie"))
                .andExpect(jsonPath("$.expiresAt").exists())
                .andExpect(jsonPath("$.idToken").doesNotExist())
                .andExpect(jsonPath("$.accessToken").doesNotExist())
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn();
        String body = result.getResponse().getContentAsString();
        assertFalse(body.contains(ADMIN_TOKEN) || body.contains("refresh-token") || body.contains("access-token"));

        List<String> cookies = setCookies(result);
        assertEquals(2, cookies.size(), cookies.toString());
        String sessionCookie = cookies.stream().filter(c -> c.startsWith(AuthCookies.SESSION_COOKIE + "=")).findFirst().orElseThrow();
        String refresh = cookies.stream().filter(c -> c.startsWith(AuthCookies.REFRESH_COOKIE + "=")).findFirst().orElseThrow();
        for (String expected : List.of(AuthCookies.SESSION_COOKIE + "=" + ADMIN_TOKEN, "Path=/api;", "Max-Age=3600", "HttpOnly", "SameSite=Strict")) {
            assertTrue(sessionCookie.contains(expected), sessionCookie + " lacks " + expected);
        }
        for (String expected : List.of("Path=/api/auth", "Max-Age=2592000", "HttpOnly", "SameSite=Strict")) {
            assertTrue(refresh.contains(expected), refresh + " lacks " + expected);
        }
        // Over plain HTTP (local development) the cookies are not Secure; over HTTPS they are.
        assertFalse(sessionCookie.contains("Secure"));
        MvcResult https = mvc.perform(login().header(CSRF, "NormaOne").secure(true)).andReturn();
        assertTrue(setCookies(https).stream().allMatch(c -> c.contains("Secure")), setCookies(https).toString());
        // The access token is never put in a cookie.
        assertFalse(cookies.stream().anyMatch(c -> c.contains("access-token")));
    }

    @Test
    void aNonBrowserClientCanStillAskForTheTokensInTheBody() throws Exception {
        cognitoIssues(ADMIN_TOKEN, "refresh-token");
        MvcResult result = mvc.perform(login().header(CSRF, "x").header("X-Token-Delivery", "body"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.idToken").value(ADMIN_TOKEN))
                .andExpect(jsonPath("$.refreshToken").value("refresh-token"))
                .andReturn();
        assertTrue(setCookies(result).isEmpty());
    }

    // ==================== the cookie authenticates; the header still wins ====================

    @Test
    void theSessionCookieAuthenticatesRequestsAndRolesStillApply() throws Exception {
        mvc.perform(get("/api/users/me").cookie(session(ADMIN_TOKEN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                .andExpect(jsonPath("$.onboardingStatus").value("COMPLETED"));
        mvc.perform(get("/api/tenant/users").cookie(session(ADMIN_TOKEN))).andExpect(status().isOk());

        // A tenant USER's cookie is authenticated, and still refused tenant-admin operations.
        mvc.perform(get("/api/users/me").cookie(session(USER_TOKEN))).andExpect(jsonPath("$.effectiveRole").value("USER"));
        mvc.perform(get("/api/tenant/users").cookie(session(USER_TOKEN))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/dashboard").cookie(session(ADMIN_TOKEN))).andExpect(status().isForbidden());

        // No cookie, or an expired/forged one: 401, the same JSON as with a bad header.
        mvc.perform(get("/api/users/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/users/me").cookie(session("expired-token")))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", containsString("Bearer")));

        // An Authorization header takes precedence over the cookie.
        mvc.perform(get("/api/users/me").cookie(session(ADMIN_TOKEN)).header(HttpHeaders.AUTHORIZATION, "Bearer " + USER_TOKEN))
                .andExpect(jsonPath("$.effectiveRole").value("USER"));
    }

    @Test
    void aStaleCookieNeverBreaksThePublicAuthEndpoints() throws Exception {
        cognitoIssues(ADMIN_TOKEN, "refresh-token");
        mvc.perform(login().header(CSRF, "NormaOne").cookie(session("expired-token"))).andExpect(status().isOk());
        mvc.perform(get("/api/auth/session").cookie(session("expired-token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.reason").value("INVALID_OR_EXPIRED"));
    }

    // ==================== CSRF ====================

    @Test
    void cookieAuthenticatedWritesNeedTheCsrfHeader() throws Exception {
        String change = "{\"name\":\"Changed\"}";
        mvc.perform(patch("/api/tenant/users/" + userId).cookie(session(ADMIN_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON).content(change))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.message", containsString("X-Requested-With")));
        assertEquals("Uma", userRepository.findById(userId).orElseThrow().getName());

        mvc.perform(patch("/api/tenant/users/" + userId).cookie(session(ADMIN_TOKEN)).header(CSRF, "NormaOne")
                        .contentType(MediaType.APPLICATION_JSON).content(change))
                .andExpect(status().isOk());
        // A request authenticated by its Authorization header is not using cookies and is not checked.
        mvc.perform(patch("/api/tenant/users/" + userId).header(HttpHeaders.AUTHORIZATION, "Bearer " + ADMIN_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Again\"}"))
                .andExpect(status().isOk());
        // Login and the other credential endpoints always need it, cookie or not (no login CSRF).
        mvc.perform(login()).andExpect(status().isForbidden());
        mvc.perform(post("/api/auth/logout")).andExpect(status().isForbidden());
        // Reads never do.
        mvc.perform(get("/api/tenant/users").cookie(session(ADMIN_TOKEN))).andExpect(status().isOk());
    }

    @Test
    void noCorsIsGrantedByDefault() throws Exception {
        MvcResult preflight = mvc.perform(options("/api/users/me")
                        .header("Origin", "https://evil.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andReturn();
        assertTrue(preflight.getResponse().getHeader("Access-Control-Allow-Origin") == null);
        assertTrue(preflight.getResponse().getHeader("Access-Control-Allow-Credentials") == null);
    }

    // ==================== session status, refresh, logout ====================

    @Test
    void sessionReportsStateWithoutEverReturningTheToken() throws Exception {
        String body = mvc.perform(get("/api/auth/session").cookie(session(ADMIN_TOKEN), refreshCookie("refresh-token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andExpect(jsonPath("$.email").value("admin@a.test"))
                .andExpect(jsonPath("$.tokenUse").value("id"))
                .andExpect(jsonPath("$.refreshAvailable").value(true))
                .andExpect(jsonPath("$.expiresAt").exists())
                .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains(ADMIN_TOKEN) || body.contains("refresh-token"));

        mvc.perform(get("/api/auth/session"))
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.reason").value("NO_SESSION"))
                .andExpect(jsonPath("$.refreshAvailable").value(false));
    }

    @Test
    void refreshRenewsTheSessionCookieThroughCognito() throws Exception {
        cognitoIssues(USER_TOKEN, null);
        MvcResult result = mvc.perform(post("/api/auth/refresh").header(CSRF, "NormaOne").cookie(refreshCookie("refresh-token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andReturn();
        verify(cognito).initiateAuth(argThat((InitiateAuthRequest r) -> r.authFlow() == AuthFlowType.REFRESH_TOKEN_AUTH
                && "refresh-token".equals(r.authParameters().get("REFRESH_TOKEN"))));
        // A new session cookie; the refresh cookie is kept because Cognito issued no new one.
        assertEquals(1, setCookies(result).size());
        assertTrue(setCookies(result).get(0).startsWith(AuthCookies.SESSION_COOKIE + "=" + USER_TOKEN));

        // No refresh cookie, or one Cognito rejects: 401 and both cookies cleared.
        MvcResult missing = mvc.perform(post("/api/auth/refresh").header(CSRF, "NormaOne"))
                .andExpect(status().isUnauthorized()).andReturn();
        assertTrue(setCookies(missing).stream().allMatch(c -> c.contains("Max-Age=0")));
        when(cognito.initiateAuth(any(InitiateAuthRequest.class)))
                .thenThrow(NotAuthorizedException.builder().message("Refresh Token has expired").build());
        MvcResult expired = mvc.perform(post("/api/auth/refresh").header(CSRF, "NormaOne").cookie(refreshCookie("old")))
                .andExpect(status().isUnauthorized()).andReturn();
        // Session, refresh and any first-login challenge cookie.
        assertEquals(3, setCookies(expired).size());
        assertTrue(setCookies(expired).stream().allMatch(c -> c.contains("Max-Age=0")));
    }

    @Test
    void logoutRevokesTheRefreshTokenAndClearsTheCookies() throws Exception {
        MvcResult result = mvc.perform(post("/api/auth/logout").header(CSRF, "NormaOne")
                        .cookie(session(ADMIN_TOKEN), refreshCookie("refresh-token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(false))
                .andExpect(jsonPath("$.reason").value("LOGGED_OUT"))
                .andReturn();
        verify(cognito).revokeToken(argThat((RevokeTokenRequest r) -> "refresh-token".equals(r.token())));
        List<String> cleared = setCookies(result);
        assertEquals(3, cleared.size(), "session, refresh and challenge cookies are all cleared");
        org.hamcrest.MatcherAssert.assertThat(cleared, hasItem(allOf(containsString(AuthCookies.CHALLENGE_COOKIE + "="),
                containsString("Max-Age=0"))));
        org.hamcrest.MatcherAssert.assertThat(cleared, hasItem(allOf(containsString(AuthCookies.SESSION_COOKIE + "="),
                containsString("Max-Age=0"), containsString("Path=/api;"))));
        org.hamcrest.MatcherAssert.assertThat(cleared, hasItem(allOf(containsString(AuthCookies.REFRESH_COOKIE + "="),
                containsString("Max-Age=0"), containsString("Path=/api/auth"))));
        org.hamcrest.MatcherAssert.assertThat(cleared, not(hasItem(containsString(ADMIN_TOKEN))));

        // Signed out already: still fine, nothing to revoke.
        mvc.perform(post("/api/auth/logout").header(CSRF, "NormaOne")).andExpect(status().isOk());
        verify(cognito, never()).revokeToken(argThat((RevokeTokenRequest r) -> r.token() == null));
    }
}
