package com.NormaOne.backend.integration;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.NormaOne.backend.bootstrap.DefaultPackageInitializer;
import com.NormaOne.backend.bootstrap.MongoIndexInitializer;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.repositories.UserRepository;
import com.NormaOne.backend.security.CognitoJwtAuthenticationConverter;
import com.NormaOne.backend.services.EmailSender;
import com.jayway.jsonpath.JsonPath;

import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;

/**
 * Runs the real application (security filter chain, controllers, services, MongoDB) against the
 * local MongoDB in the separate {@code normaone_test} database. Cognito is mocked and JWTs are
 * simulated with spring-security-test, so no AWS credentials or live user pool are used. Roles
 * come from the application's own converter, exactly as in production.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
abstract class IntegrationTestBase {

    protected static final List<String> COLLECTIONS = List.of(
            "users", "tenants", "plan_definitions", "tenant_subscriptions", "subscription_history", "audit_events",
            "notifications", "notification_receipts", "plan_history", "plan_change_requests", "email_outbox");

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected MongoTemplate mongo;

    @Autowired
    protected UserRepository userRepository;

    @Autowired
    private CognitoJwtAuthenticationConverter converter;

    @Autowired
    private MongoIndexInitializer indexInitializer;

    @Autowired
    protected DefaultPackageInitializer packageInitializer;

    @MockitoBean
    protected CognitoIdentityProviderClient cognito;

    /** No mail server in tests: unconfigured unless a test stubs configured() and send(). */
    @MockitoBean
    protected EmailSender emailSender;

    @BeforeEach
    void resetDatabase() throws Exception {
        for (String collection : COLLECTIONS) {
            mongo.remove(new Query(), collection);
        }
        indexInitializer.run(null);
        packageInitializer.run(null);
    }

    /** Access-token style JWT (no email claims) for an already known user. */
    protected RequestPostProcessor as(String sub) {
        return jwt().jwt(j -> j.subject(sub).claim("token_use", "access")).authorities(converter.authoritiesConverter());
    }

    /** ID-token style JWT with a verified email (used for onboarding and invitation linking). */
    protected RequestPostProcessor asVerified(String sub, String email, String name) {
        return jwt().jwt(j -> j.subject(sub).claim("token_use", "id").claim("email", email)
                .claim("email_verified", true).claim("name", name)).authorities(converter.authoritiesConverter());
    }

    /** ID-token style JWT whose email may or may not be verified. */
    protected RequestPostProcessor asIdToken(String sub, String email, boolean verified) {
        return jwt().jwt(j -> j.subject(sub).claim("token_use", "id").claim("email", email)
                .claim("email_verified", verified)).authorities(converter.authoritiesConverter());
    }

    protected static String onboardingBody(String organization, String subdomain) {
        return "{\"organizationName\":\"" + organization + "\",\"subdomain\":\"" + subdomain + "\",\"countryCode\":\"ES\"}";
    }

    /** Onboards a new organization for a verified user and returns the tenant id. */
    protected String onboard(String sub, String email, String subdomain) throws Exception {
        String body = mvc.perform(post("/api/onboarding/tenant").with(asVerified(sub, email, "Admin " + subdomain))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("Org " + subdomain, subdomain)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.tenantId");
    }

    /** Creates a platform Super Admin record directly (as the server-side bootstrap would). */
    protected user superAdmin(String sub) {
        return userRepository.insert(user.builder()
                .cognitoSub(sub)
                .name("Platform Admin")
                .email(sub + "@platform.example")
                .status(UserStatus.ACTIVE)
                .roles(Set.of(UserRole.SUPER_ADMIN))
                .recordState(RecordState.ACTIVE)
                .activatedAt(Instant.now())
                .build());
    }

    protected static String json(String body, String path) {
        Object value = JsonPath.read(body, path);
        return value == null ? null : String.valueOf(value);
    }
}
