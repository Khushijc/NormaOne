package com.NormaOne.backend.integration;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;

import com.NormaOne.backend.dto.onboarding.TenantOnboardingRequest;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.CountryCode;
import com.NormaOne.backend.model.core.enums.TenantLocale;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.TenantTimeZone;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.plans.PlanDefinition;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.services.OnboardingService;

class OnboardingIntegrationTest extends IntegrationTestBase {

    @Autowired
    private OnboardingService onboardingService;

    @Test
    void verifiedUserCompletesOnboardingAndTenantReceivesActiveBasicPackage() throws Exception {
        mvc.perform(get("/api/onboarding/status").with(asVerified("sub-ana", "ana@acme.test", "Ana")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onboardingStatus").value("NOT_STARTED"))
                .andExpect(jsonPath("$.requiresTenantSetup").value(true));

        String tenantId = onboard("sub-ana", "ana@acme.test", "acme");

        Tenant tenant = mongo.findById(tenantId, Tenant.class);
        assertEquals(TenantStatus.ACTIVE, tenant.getStatus());
        List<TenantSubscription> subs = mongo.find(new Query(Criteria.where("tenantId").is(tenantId)), TenantSubscription.class);
        assertEquals(1, subs.size());
        TenantSubscription sub = subs.get(0);
        assertEquals("BASIC", sub.getPlanCode());
        assertEquals(tenantId, sub.getTenantId());
        assertTrue(sub.getCurrent());
        assertEquals(com.NormaOne.backend.model.plans.enums.SubscriptionStatus.ACTIVE, sub.getStatus());
        PlanDefinition plan = mongo.findById(sub.getPlanDocsId(), PlanDefinition.class);
        assertEquals("BASIC", plan.getPlanCode());

        mvc.perform(get("/api/users/me").with(as("sub-ana")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId").value(tenantId))
                .andExpect(jsonPath("$.onboardingStatus").value("COMPLETED"))
                .andExpect(jsonPath("$.effectiveRole").value("ADMIN"))
                .andExpect(jsonPath("$.requiresTenantSetup").value(false));
        mvc.perform(get("/api/onboarding/status").with(as("sub-ana")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onboardingCompleted").value(true))
                .andExpect(jsonPath("$.packageCode").value("BASIC"))
                .andExpect(jsonPath("$.subscriptionStatus").value("ACTIVE"));
        mvc.perform(get("/api/tenant/package").with(as("sub-ana")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId").value(tenantId))
                .andExpect(jsonPath("$.plan.planCode").value("BASIC"))
                .andExpect(jsonPath("$.plan.name").value("Basic"));
    }

    @Test
    void unauthenticatedAndUnverifiedIdentitiesCannotBypassAuthentication() throws Exception {
        mvc.perform(get("/api/users/me")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/onboarding/tenant").contentType(MediaType.APPLICATION_JSON).content(onboardingBody("X", "xorg")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/tenant/users")).andExpect(status().isUnauthorized());
        // Public auth endpoints stay reachable without a token (validation error, not 401). Credential
        // requests carry the CSRF header (CsrfHeaderFilter); CookieSessionIntegrationTest covers its absence.
        mvc.perform(post("/api/auth/login").header("X-Requested-With", "NormaOne")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/onboarding/tenant")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt()
                                .jwt(j -> j.subject("sub-unverified").claim("email", "u@x.test").claim("email_verified", false)))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("X", "xorg")))
                .andExpect(status().isForbidden());
        assertEquals(0, mongo.count(new Query(), Tenant.class));
    }

    @Test
    void userWithoutOnboardingCannotReachTenantOrPlatformApis() throws Exception {
        mvc.perform(get("/api/tenant/users").with(asVerified("sub-new", "new@x.test", "New"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/package").with(asVerified("sub-new", "new@x.test", "New"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/tenants").with(asVerified("sub-new", "new@x.test", "New"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/users/me").with(asVerified("sub-new", "new@x.test", "New")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requiresTenantSetup").value(true));
    }

    @Test
    void retryingOnboardingDoesNotCreateDuplicates() throws Exception {
        String first = onboard("sub-bob", "bob@b.test", "bobco");
        String second = onboard("sub-bob", "bob@b.test", "bobco");
        assertEquals(first, second);
        assertEquals(1, mongo.count(new Query(), Tenant.class));
        assertEquals(1, mongo.count(new Query(), user.class));
        assertEquals(1, mongo.count(new Query(), TenantSubscription.class));

        mvc.perform(post("/api/onboarding/tenant").with(asVerified("sub-bob", "bob@b.test", "Bob"))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("Other", "otherco")))
                .andExpect(status().isConflict());
        assertEquals(1, mongo.count(new Query(), Tenant.class));
    }

    @Test
    void subdomainOfAnotherOrganizationIsRejected() throws Exception {
        onboard("sub-1", "one@x.test", "taken");
        mvc.perform(post("/api/onboarding/tenant").with(asVerified("sub-2", "two@x.test", "Two"))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("Two", "taken")))
                .andExpect(status().isConflict());
    }

    @Test
    void clientSuppliedRolesAndTenantIdsAreIgnored() throws Exception {
        String other = onboard("sub-owner", "owner@x.test", "ownerco");
        String body = "{\"organizationName\":\"Sneaky\",\"subdomain\":\"sneaky\",\"countryCode\":\"ES\","
                + "\"roles\":[\"SUPER_ADMIN\"],\"tenantId\":\"" + other + "\",\"cognitoSub\":\"sub-owner\"}";
        mvc.perform(post("/api/onboarding/tenant").with(asVerified("sub-sneaky", "s@x.test", "S"))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userRoles[0]").value("ADMIN"));
        user created = userRepository.findByCognitoSub("sub-sneaky").orElseThrow();
        assertTrue(!created.getTenantId().equals(other));
        assertEquals(1, created.getRoles().size());
    }

    @Test
    void failedOnboardingLeavesNoOrphanRecords() throws Exception {
        // Make the default package unavailable so provisioning fails after the tenant was inserted.
        mongo.updateMulti(new Query(Criteria.where("planCode").is("BASIC")), new Update().set("status", PlanStatus.INACTIVE), PlanDefinition.class);

        mvc.perform(post("/api/onboarding/tenant").with(asVerified("sub-fail", "f@x.test", "F"))
                        .contentType(MediaType.APPLICATION_JSON).content(onboardingBody("Fail", "failco")))
                .andExpect(status().isServiceUnavailable());

        assertEquals(0, mongo.count(new Query(), Tenant.class));
        assertEquals(0, mongo.count(new Query(), user.class));
        assertEquals(0, mongo.count(new Query(), TenantSubscription.class));
        assertTrue(userRepository.findByCognitoSub("sub-fail").isEmpty());
    }

    @Test
    void concurrentOnboardingRetriesCreateOneTenantAndOnePackage() throws Exception {
        Jwt jwt = Jwt.withTokenValue("t").header("alg", "RS256").subject("sub-race").claim("email", "race@x.test")
                .claim("email_verified", true).claim("name", "Race").issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
        TenantOnboardingRequest request = new TenantOnboardingRequest("Race Co", "raceco", CountryCode.ES,
                TenantLocale.ES_ES, TenantTimeZone.EUROPE_MADRID, null, null, null, null, null, null, null);
        ExecutorService pool = Executors.newFixedThreadPool(6);
        List<Future<String>> results = new ArrayList<>();
        try {
            for (int i = 0; i < 6; i++) {
                Callable<String> call = () -> {
                    try {
                        return onboardingService.onboardTenant(request, jwt).tenantId();
                    } catch (RuntimeException ex) {
                        return "error:" + ex.getClass().getSimpleName();
                    }
                };
                results.add(pool.submit(call));
            }
            for (Future<String> f : results) {
                f.get();
            }
        } finally {
            pool.shutdown();
        }
        assertEquals(1, mongo.count(new Query(Criteria.where("subdomain").is("raceco")), Tenant.class));
        assertEquals(1, mongo.count(new Query(), user.class));
        assertEquals(1, mongo.count(new Query(Criteria.where("current").is(true)), TenantSubscription.class));
        // A final retry now succeeds idempotently.
        assertEquals(mongo.findOne(new Query(), Tenant.class).getId(), onboardingService.onboardTenant(request, jwt).tenantId());
    }
}
