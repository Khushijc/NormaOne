package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.security.AuthCookies;

import jakarta.servlet.http.Cookie;
import software.amazon.awssdk.services.cognitoidentityprovider.model.AuthenticationResultType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ChallengeNameType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.DescribeUserPoolRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.DescribeUserPoolResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InitiateAuthResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InvalidPasswordException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.NotAuthorizedException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.PasswordPolicyType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeRequest;
import software.amazon.awssdk.services.cognitoidentityprovider.model.RespondToAuthChallengeResponse;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserPoolPolicyType;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserPoolType;

/**
 * An invited account's first login: the temporary password yields only Cognito's NEW_PASSWORD_REQUIRED
 * challenge — no session — and the session exists only once a permanent password is set.
 */
class FirstLoginIntegrationTest extends IntegrationTestBase {

    private static final String CSRF = "X-Requested-With";
    private static final String CHALLENGE_SESSION = "cognito-challenge-session";

    private void cognitoChallenges() {
        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenReturn(InitiateAuthResponse.builder()
                .challengeName(ChallengeNameType.NEW_PASSWORD_REQUIRED)
                .session(CHALLENGE_SESSION)
                .build());
    }

    private static MockHttpServletRequestBuilder login() {
        return post("/api/auth/login").header(CSRF, "NormaOne").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"uma@a.test\",\"password\":\"Temp#Pass123\"}");
    }

    private static MockHttpServletRequestBuilder newPassword(String password) {
        return post("/api/auth/new-password").header(CSRF, "NormaOne").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"uma@a.test\",\"newPassword\":\"" + password + "\"}");
    }

    private static List<String> setCookies(MvcResult result) {
        return result.getResponse().getHeaders(HttpHeaders.SET_COOKIE);
    }

    // ==================== 5, 9. a temporary password authenticates nothing ====================

    @Test
    void aTemporaryPasswordYieldsOnlyTheChallenge() throws Exception {
        cognitoChallenges();
        MvcResult result = mvc.perform(login())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.challenge").value("NEW_PASSWORD_REQUIRED"))
                .andExpect(jsonPath("$.tokenType").doesNotExist())
                .andExpect(jsonPath("$.idToken").doesNotExist())
                .andExpect(jsonPath("$.challengeSession").doesNotExist())
                .andReturn();
        assertFalse(result.getResponse().getContentAsString().contains(CHALLENGE_SESSION));

        List<String> cookies = setCookies(result);
        String challenge = cookies.stream().filter(c -> c.startsWith(AuthCookies.CHALLENGE_COOKIE + "=")).findFirst().orElseThrow();
        for (String expected : List.of(CHALLENGE_SESSION, "Path=/api/auth", "Max-Age=180", "HttpOnly", "SameSite=Strict")) {
            assertTrue(challenge.contains(expected), challenge + " lacks " + expected);
        }
        // No session is set — any earlier one is cleared.
        assertTrue(cookies.stream().filter(c -> c.startsWith(AuthCookies.SESSION_COOKIE + "=")).allMatch(c -> c.contains("Max-Age=0")), cookies.toString());

        // The challenge cookie is not a session: protected routes stay closed.
        mvc.perform(get("/api/users/me").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, CHALLENGE_SESSION)))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/organization").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, CHALLENGE_SESSION)))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/session").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, CHALLENGE_SESSION)))
                .andExpect(jsonPath("$.authenticated").value(false));
    }

    // ==================== 6, 8. the permanent password completes it ====================

    @Test
    void thePermanentPasswordCompletesTheChallengeAndOnlyThenSetsTheSession() throws Exception {
        when(cognito.respondToAuthChallenge(any(RespondToAuthChallengeRequest.class))).thenReturn(RespondToAuthChallengeResponse.builder()
                .authenticationResult(AuthenticationResultType.builder()
                        .idToken("first-id-token").accessToken("first-access").refreshToken("first-refresh").expiresIn(3600).build())
                .build());

        MvcResult result = mvc.perform(newPassword("Permanent#Pass456").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, CHALLENGE_SESSION)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tokenType").value("Cookie"))
                .andExpect(jsonPath("$.idToken").doesNotExist())
                .andReturn();
        verify(cognito).respondToAuthChallenge(argThat((RespondToAuthChallengeRequest r) ->
                r.challengeName() == ChallengeNameType.NEW_PASSWORD_REQUIRED
                        && CHALLENGE_SESSION.equals(r.session())
                        && "uma@a.test".equals(r.challengeResponses().get("USERNAME"))
                        && "Permanent#Pass456".equals(r.challengeResponses().get("NEW_PASSWORD"))));
        List<String> cookies = setCookies(result);
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith(AuthCookies.SESSION_COOKIE + "=first-id-token") && c.contains("HttpOnly")), cookies.toString());
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith(AuthCookies.REFRESH_COOKIE + "=first-refresh")));
        assertTrue(cookies.stream().anyMatch(c -> c.startsWith(AuthCookies.CHALLENGE_COOKIE + "=") && c.contains("Max-Age=0")));
        // The password is not echoed anywhere in the answer.
        assertFalse(result.getResponse().getContentAsString().contains("Permanent#Pass456"));
    }

    @Test
    void refusedPasswordsAndExpiredChallengesAreReportedNotSwallowed() throws Exception {
        // No challenge in progress.
        mvc.perform(newPassword("Permanent#Pass456"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("Sign in again")));
        verify(cognito, never()).respondToAuthChallenge(any(RespondToAuthChallengeRequest.class));

        // Too short for the request's own validation (before Cognito).
        mvc.perform(newPassword("short").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, CHALLENGE_SESSION)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.newPassword").exists());

        // Cognito's policy refuses it: its own message, and the challenge stays usable.
        when(cognito.respondToAuthChallenge(any(RespondToAuthChallengeRequest.class))).thenThrow(
                InvalidPasswordException.builder().message("Password does not conform to policy: Password must have symbol characters").build());
        mvc.perform(newPassword("Permanent12345").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, CHALLENGE_SESSION)))
                .andExpect(status().isBadRequest());

        // The challenge session expired: 401, and the stale challenge cookie is cleared.
        when(cognito.respondToAuthChallenge(any(RespondToAuthChallengeRequest.class))).thenThrow(
                NotAuthorizedException.builder().message("Invalid session for the user, session is expired.").build());
        MvcResult expired = mvc.perform(newPassword("Permanent#Pass456").cookie(new Cookie(AuthCookies.CHALLENGE_COOKIE, "old")))
                .andExpect(status().isUnauthorized()).andReturn();
        assertTrue(setCookies(expired).stream().anyMatch(c -> c.startsWith(AuthCookies.CHALLENGE_COOKIE + "=") && c.contains("Max-Age=0")));

        // The CSRF header is required here like on every /api/auth write.
        mvc.perform(post("/api/auth/new-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"uma@a.test\",\"newPassword\":\"Permanent#Pass456\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void anExpiredTemporaryPasswordSaysToAskForANewInvitation() throws Exception {
        when(cognito.initiateAuth(any(InitiateAuthRequest.class))).thenThrow(NotAuthorizedException.builder()
                .message("Temporary password has expired and must be reset by an administrator.").build());
        mvc.perform(login())
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("resend the invitation")));
    }

    @Test
    void aNonBrowserClientGetsTheChallengeSessionInTheBody() throws Exception {
        cognitoChallenges();
        MvcResult result = mvc.perform(login().header("X-Token-Delivery", "body"))
                .andExpect(jsonPath("$.challenge").value("NEW_PASSWORD_REQUIRED"))
                .andExpect(jsonPath("$.challengeSession").value(CHALLENGE_SESSION))
                .andReturn();
        assertTrue(setCookies(result).isEmpty());
    }

    // ==================== the policy the set-password page shows ====================

    @Test
    void thePasswordPolicyComesFromTheUserPoolOrCognitosDefaults() throws Exception {
        mvc.perform(get("/api/auth/password-policy"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("DEFAULT"))
                .andExpect(jsonPath("$.minimumLength").value(8));

        when(cognito.describeUserPool(any(DescribeUserPoolRequest.class))).thenReturn(DescribeUserPoolResponse.builder()
                .userPool(UserPoolType.builder().policies(UserPoolPolicyType.builder().passwordPolicy(PasswordPolicyType.builder()
                        .minimumLength(12).requireUppercase(true).requireLowercase(true).requireNumbers(true).requireSymbols(false)
                        .temporaryPasswordValidityDays(7).build()).build()).build())
                .build());
        String body = mvc.perform(get("/api/auth/password-policy"))
                .andExpect(jsonPath("$.source").value("COGNITO"))
                .andExpect(jsonPath("$.minimumLength").value(12))
                .andExpect(jsonPath("$.requireSymbols").value(false))
                .andReturn().getResponse().getContentAsString();
        assertEquals(false, body.contains("password\":\""));
    }
}
