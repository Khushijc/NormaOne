package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.plans.SubscriptionHistory;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.SubscriptionEventType;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;

/**
 * Plans ("packages") and subscriptions as the Super Admin manages them: versioned plans that are
 * immutable once published, status rules that keep onboarding working, and plan changes recorded in
 * the subscription history — and nobody else can do any of it.
 */
class PlanManagementIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    private String tenantA;
    private String basicId;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        basicId = json(mvc.perform(get("/api/super-admin/plans?planCode=basic").with(as(ROOT)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), "$.content[0].id");
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String planBody(String code, String extra) {
        return "{\"planCode\":\"" + code + "\",\"name\":\"Plan " + code + "\",\"billingCycle\":\"MONTHLY\",\"listPrice\":49.90,"
                + "\"maxEmployees\":50" + (extra.isEmpty() ? "" : "," + extra) + "}";
    }

    private String createPlan(String body) throws Exception {
        return json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), body))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
    }

    private void setStatus(String planId, String status) throws Exception {
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + planId + "/status").with(as(ROOT)), "{\"status\":\"" + status + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(status));
    }

    // ==================== plans ====================

    @Test
    void listsTheSeededDefaultPlanWithItsSubscriptions() throws Exception {
        mvc.perform(get("/api/super-admin/plans").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].planCode").value("BASIC"))
                .andExpect(jsonPath("$.content[0].status").value("ACTIVE"))
                .andExpect(jsonPath("$.content[0].defaultPlan").value(true))
                .andExpect(jsonPath("$.content[0].moduleApps[0]").value("NORMAONE"));
        mvc.perform(get("/api/super-admin/plans/" + basicId).with(as(ROOT)))
                .andExpect(jsonPath("$.currentSubscriptions").value(1));
        mvc.perform(get("/api/super-admin/plans/000000000000000000000000").with(as(ROOT))).andExpect(status().isNotFound());
    }

    @Test
    void createsDraftsAndNewVersionsAndValidatesInput() throws Exception {
        String body = mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        planBody("pro", "\"moduleApps\":[\"FACTURAFLOW\",\"NORMAONE\",\"FACTURAFLOW\",\"JORNADAPULSE\"],"
                                + "\"defaultPlan\":true,\"status\":\"ACTIVE\"")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.planCode").value("PRO"))
                .andExpect(jsonPath("$.planVersion").value(1))
                // Status and the default flag are never set by creation.
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.defaultPlan").value(false))
                .andExpect(jsonPath("$.currencyCode").value("EUR"))
                .andExpect(jsonPath("$.trialDays").value(0))
                .andExpect(jsonPath("$.moduleApps", hasSize(3)))
                .andExpect(jsonPath("$.moduleApps[0]").value("NORMAONE"))
                .andExpect(jsonPath("$.moduleApps[1]").value("FACTURAFLOW"))
                .andExpect(jsonPath("$.moduleApps[2]").value("JORNADAPULSE"))
                .andReturn().getResponse().getContentAsString();
        String pro1 = json(body, "$.id");
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.PLAN_CREATED).and("targetId").is(pro1)), AuditEvent.class));

        // Without a version, the next one; an explicit version that exists is a conflict.
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), planBody("PRO", "")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.planVersion").value(2));
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), planBody("PRO", "\"planVersion\":1")))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/super-admin/plans?planCode=pro").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].planVersion").value(2));

        // Invalid input names the field.
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), "{\"planCode\":\"X\",\"name\":\"X\",\"listPrice\":-1,\"maxEmployees\":0}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.listPrice").exists())
                .andExpect(jsonPath("$.fieldErrors.maxEmployees").exists())
                .andExpect(jsonPath("$.fieldErrors.billingCycle").exists());
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), planBody("bad code!", ""))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), planBody("X", "\"moduleApps\":[\"PAYROLL\"]")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("FACTURAFLOW")));
        mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)), planBody("X",
                        "\"effectiveFrom\":\"2027-01-01T00:00:00Z\",\"effectiveUntil\":\"2026-01-01T00:00:00Z\"")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aPublishedVersionChangesOnlyItsMetadata() throws Exception {
        String pro = createPlan(planBody("PRO", "\"moduleApps\":[\"NORMAONE\"]"));
        // A draft can change anything.
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro).with(as(ROOT)),
                        "{\"listPrice\":59.00,\"moduleApps\":[\"NORMAONE\",\"DATOSPILOT\"],\"trialDays\":14}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listPrice").value(59.0))
                .andExpect(jsonPath("$.trialDays").value(14))
                .andExpect(jsonPath("$.moduleApps[1]").value("DATOSPILOT"));
        setStatus(pro, "ACTIVE");

        // Published: commercial terms and features are a new version, nothing is written.
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro).with(as(ROOT)), "{\"listPrice\":10,\"name\":\"Cheaper\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("listPrice")));
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro).with(as(ROOT)), "{\"moduleApps\":[\"NORMAONE\"]}"))
                .andExpect(status().isConflict());
        // The same value, written as a different number, is no change.
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro).with(as(ROOT)), "{\"listPrice\":59}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro).with(as(ROOT)),
                        "{\"name\":\"Professional\",\"description\":\"For growing companies\",\"publiclyAvailable\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Professional"))
                .andExpect(jsonPath("$.publiclyAvailable").value(true))
                .andExpect(jsonPath("$.listPrice").value(59.0));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.PLAN_UPDATED).and("targetId").is(pro)), AuditEvent.class));

        setStatus(pro, "ARCHIVED");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro).with(as(ROOT)), "{\"name\":\"Back\"}")).andExpect(status().isConflict());
    }

    @Test
    void statusTransitionsKeepTheDefaultPlanAvailable() throws Exception {
        String pro = createPlan(planBody("PRO", ""));
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro + "/status").with(as(ROOT)), "{\"status\":\"INACTIVE\"}"))
                .andExpect(status().isConflict());
        setStatus(pro, "ACTIVE");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isConflict());
        setStatus(pro, "INACTIVE");
        setStatus(pro, "ACTIVE");
        setStatus(pro, "ARCHIVED");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + pro + "/status").with(as(ROOT)), "{\"status\":\"DRAFT\"}"))
                .andExpect(status().isConflict());

        // The last ACTIVE version of the default plan cannot go: onboarding needs it.
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + basicId + "/status").with(as(ROOT)), "{\"status\":\"INACTIVE\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("default plan")));
        // Once a newer BASIC version is active, the old one may be retired and onboarding uses the new one.
        String basic2 = createPlan("{\"planCode\":\"BASIC\",\"name\":\"Basic\",\"billingCycle\":\"MONTHLY\",\"listPrice\":0,"
                + "\"maxEmployees\":10,\"moduleApps\":[\"NORMAONE\",\"SAFEVOICE\"]}");
        setStatus(basic2, "ACTIVE");
        setStatus(basicId, "INACTIVE");
        String tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/package").with(as(ROOT)))
                .andExpect(jsonPath("$.plan.planCode").value("BASIC"))
                .andExpect(jsonPath("$.plan.planVersion").value(2));
        // The existing subscription keeps the version it was given.
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)))
                .andExpect(jsonPath("$.plan.planVersion").value(1))
                .andExpect(jsonPath("$.plan.status").value("INACTIVE"));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.PLAN_STATUS_CHANGED).and("targetId").is(basicId)),
                AuditEvent.class));
    }

    // ==================== subscriptions ====================

    @Test
    void changesATenantsPlanThroughTheSubscriptionHistory() throws Exception {
        String pro = createPlan(planBody("PRO", "\"moduleApps\":[\"NORMAONE\",\"FACTURAFLOW\"]"));
        TenantSubscription original = mongo.findOne(new Query(Criteria.where("tenantId").is(tenantA).and("current").is(true)),
                TenantSubscription.class);
        assertNotNull(original);

        // A draft plan cannot be assigned; an unknown tenant or plan is not found.
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"" + pro + "\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(put("/api/super-admin/tenants/000000000000000000000000/package").with(as(ROOT)), "{\"planId\":\"" + pro + "\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"nope\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{}"))
                .andExpect(status().isBadRequest());

        setStatus(pro, "ACTIVE");
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)),
                        "{\"planId\":\"" + pro + "\",\"reason\":\"Upgrade requested by the customer\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.plan.planCode").value("PRO"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.assignmentSource").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.agreedPrice").value(49.9));
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"" + pro + "\"}"))
                .andExpect(status().isConflict());

        // Exactly one current subscription; the previous one is closed, not deleted.
        List<TenantSubscription> all = mongo.find(new Query(Criteria.where("tenantId").is(tenantA)), TenantSubscription.class);
        assertEquals(2, all.size());
        assertEquals(1, all.stream().filter(TenantSubscription::getCurrent).count());
        TenantSubscription closed = all.stream().filter(s -> s.getId().equals(original.getId())).findFirst().orElseThrow();
        assertFalse(closed.getCurrent());
        assertEquals(SubscriptionStatus.CANCELLED, closed.getStatus());
        assertNotNull(closed.getEndedAt());
        assertTrue(closed.getCancellationReason().contains("PRO v1"));

        List<SubscriptionHistory> history = mongo.find(new Query(Criteria.where("tenantId").is(tenantA)), SubscriptionHistory.class);
        assertEquals(List.of(SubscriptionEventType.CREATED, SubscriptionEventType.PLAN_CHANGED),
                history.stream().map(SubscriptionHistory::getEventType).sorted().toList());
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/package/history").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].eventType").value("PLAN_CHANGED"))
                .andExpect(jsonPath("$.content[0].previousPlanId").value(basicId))
                .andExpect(jsonPath("$.content[0].newPlanId").value(pro))
                .andExpect(jsonPath("$.content[0].previousStatus").value("ACTIVE"))
                .andExpect(jsonPath("$.content[0].reason").value("Upgrade requested by the customer"));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.PACKAGE_CHANGED).and("tenantId").is(tenantA)),
                AuditEvent.class));

        // Every read agrees: the tenant's package, the cross-tenant list, the plan counts and the Tenant Admin's view.
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT))).andExpect(jsonPath("$.plan.planCode").value("PRO"));
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(jsonPath("$.plan.planCode").value("PRO"));
        mvc.perform(get("/api/super-admin/subscriptions?planCode=pro").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].organization.id").value(tenantA))
                .andExpect(jsonPath("$.content[0].subscription.plan.planCode").value("PRO"));
        mvc.perform(get("/api/super-admin/subscriptions?planCode=BASIC").with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/super-admin/plans/" + pro).with(as(ROOT))).andExpect(jsonPath("$.currentSubscriptions").value(1));
        mvc.perform(get("/api/super-admin/plans/" + basicId).with(as(ROOT))).andExpect(jsonPath("$.currentSubscriptions").value(0));

        // And back to BASIC.
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"" + basicId + "\"}"))
                .andExpect(status().isOk());
        assertEquals(1, mongo.count(new Query(Criteria.where("tenantId").is(tenantA).and("current").is(true)), TenantSubscription.class));
    }

    // ==================== who may do it ====================

    @Test
    void onlyTheSuperAdminManagesPlansAndPackages() throws Exception {
        long plans = mongo.count(new Query(), "plan_definitions");
        for (String sub : new String[] {"sub-admin-a"}) {
            mvc.perform(get("/api/super-admin/plans").with(as(sub))).andExpect(status().isForbidden());
            mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(sub)), planBody("HACK", ""))).andExpect(status().isForbidden());
            mvc.perform(jsonBody(patch("/api/super-admin/plans/" + basicId + "/status").with(as(sub)), "{\"status\":\"INACTIVE\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/subscriptions").with(as(sub))).andExpect(status().isForbidden());
            mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(sub)), "{\"planId\":\"" + basicId + "\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/package/history").with(as(sub))).andExpect(status().isForbidden());
        }
        // The tenant API has no way to change its own package.
        mvc.perform(jsonBody(put("/api/tenant/package").with(as("sub-admin-a")), "{\"planId\":\"" + basicId + "\"}"))
                .andExpect(status().isMethodNotAllowed());
        mvc.perform(get("/api/super-admin/plans")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/super-admin/plans").with(asVerified("sub-new", "new@x.test", "New"))).andExpect(status().isForbidden());
        assertEquals(plans, mongo.count(new Query(), "plan_definitions"));
    }
}
