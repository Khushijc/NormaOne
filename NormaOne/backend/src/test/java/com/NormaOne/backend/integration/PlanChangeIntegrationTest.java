package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.mail.MailSendException;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.notification.OutboundEmail;
import com.NormaOne.backend.model.notification.enums.OutboundEmailStatus;
import com.NormaOne.backend.model.plans.PlanChangeRequest;
import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.SubscriptionHistory;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;

/**
 * Plan management, the plan history, the Tenant Admin's plan catalogue, and plan-change requests with
 * their approval, rejection and Super Admin email — with who may do what.
 *
 *   sub-root     SUPER_ADMIN (sub-root@platform.example)
 *   alpha        sub-admin-a ADMIN (owner) · sub-uma USER
 *   bravo        sub-admin-b ADMIN (owner)
 * PRO is ACTIVE and offered to customers; HIDDEN is ACTIVE but not marked public (Tenant Admins see and
 * may request every ACTIVE plan all the same); both tenants start on BASIC.
 */
class PlanChangeIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    private String tenantA;
    private String tenantB;
    private String proId;
    private String hiddenId;
    private String rootId;

    @BeforeEach
    void platform() throws Exception {
        rootId = superAdmin(ROOT).getId();
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), "{\"name\":\"Uma\",\"email\":\"uma@a.test\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/users/me").with(asVerified("sub-uma", "uma@a.test", "Uma"))).andExpect(jsonPath("$.effectiveRole").value("USER"));
        proId = createPlan(planBody("PRO", "\"publiclyAvailable\":true,\"maxUsers\":25,\"durationMonths\":12,"
                + "\"moduleApps\":[\"NORMAONE\",\"FACTURAFLOW\",\"JORNADAPULSE\"]"));
        setStatus(proId, "ACTIVE");
        hiddenId = createPlan(planBody("HIDDEN", "\"publiclyAvailable\":false"));
        setStatus(hiddenId, "ACTIVE");
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
                .andExpect(status().isOk());
    }

    private String requestPlan(String adminSub, String planId) throws Exception {
        return json(mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as(adminSub)),
                        "{\"planId\":\"" + planId + "\",\"reason\":\"We are growing\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
    }

    private long history(PlanHistoryEventType type, String tenantId) {
        Criteria c = Criteria.where("eventType").is(type);
        if (tenantId != null) {
            c = c.and("tenantId").is(tenantId);
        }
        return mongo.count(new Query(c), PlanHistoryEntry.class);
    }

    // ==================== 1, 15. Super Admin plan management and validation ====================

    @Test
    void theSuperAdminCreatesAndUpdatesPlansAndEveryChangeIsInTheHistory() throws Exception {
        String id = json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        planBody("TEAM", "\"currencyCode\":\"usd\",\"maxUsers\":10,\"durationMonths\":6,\"moduleApps\":[\"SAFEVOICE\",\"NORMAONE\",\"SAFEVOICE\"]")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.currencyCode").value("USD"))
                .andExpect(jsonPath("$.maxUsers").value(10))
                .andExpect(jsonPath("$.durationMonths").value(6))
                .andExpect(jsonPath("$.moduleApps", org.hamcrest.Matchers.contains("NORMAONE", "SAFEVOICE")))
                .andExpect(jsonPath("$.latestVersion").value(true))
                .andReturn().getResponse().getContentAsString(), "$.id");

        // A draft changes freely; each field is recorded with its previous and new value.
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + id).with(as(ROOT)), "{\"listPrice\":59.00,\"maxUsers\":20,\"name\":\"Team\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listPrice").value(59.00))
                .andExpect(jsonPath("$.maxUsers").value(20));
        mvc.perform(get("/api/super-admin/plan-history?planId=" + id + "&eventType=PLAN_UPDATED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].actorUserId").value(rootId))
                .andExpect(jsonPath("$.content[0].actorRole").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.content[0].changes[?(@.field=='listPrice')].from", hasItem("49.90")))
                .andExpect(jsonPath("$.content[0].changes[?(@.field=='listPrice')].to", hasItem("59.00")))
                .andExpect(jsonPath("$.content[0].changes[?(@.field=='maxUsers')].from", hasItem("10")))
                .andExpect(jsonPath("$.content[0].changes[?(@.field=='name')].to", hasItem("Team")));

        // Activation is recorded too; a published version keeps its terms (409, nothing recorded).
        setStatus(id, "ACTIVE");
        mvc.perform(get("/api/super-admin/plan-history?planId=" + id + "&eventType=PLAN_STATUS_CHANGED").with(as(ROOT)))
                .andExpect(jsonPath("$.content[0].changes[0].from").value("DRAFT"))
                .andExpect(jsonPath("$.content[0].changes[0].to").value("ACTIVE"))
                .andExpect(jsonPath("$.content[0].status").value("ACTIVE"));
        long before = mongo.count(new Query(Criteria.where("planId").is(id)), PlanHistoryEntry.class);
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + id).with(as(ROOT)), "{\"durationMonths\":24}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("durationMonths")));
        assertEquals(before, mongo.count(new Query(Criteria.where("planId").is(id)), PlanHistoryEntry.class));
        // The display metadata of a published plan can still change.
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + id).with(as(ROOT)), "{\"description\":\"For small teams\"}"))
                .andExpect(status().isOk());

        // A new version supersedes it: the old one is reported as a historical version.
        String v2 = createPlan(planBody("TEAM", "\"maxUsers\":30"));
        mvc.perform(get("/api/super-admin/plans/" + v2).with(as(ROOT))).andExpect(jsonPath("$.planVersion").value(2));
        mvc.perform(get("/api/super-admin/plans/" + id).with(as(ROOT))).andExpect(jsonPath("$.latestVersion").value(false));
        // PRO, HIDDEN, TEAM v1 and TEAM v2.
        assertEquals(4, history(PlanHistoryEventType.PLAN_CREATED, null));
    }

    @Test
    void planFieldsAndModuleIdentifiersAreValidated() throws Exception {
        String create = "/api/super-admin/plans";
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("BAD", "\"currencyCode\":\"ABC\"")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message", containsString("ISO 4217")));
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("BAD", "\"currencyCode\":\"EURO\""))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("BAD", "\"moduleApps\":[\"PAYROLL\"]"))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("BAD", "\"maxUsers\":0"))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("BAD", "\"durationMonths\":121"))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("BAD", "\"listPrice\":-1"))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("B D", ""))).andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post(create).with(as(ROOT)),
                        "{\"planCode\":\"BAD\",\"name\":\"Bad\",\"billingCycle\":\"WEEKLY\",\"listPrice\":1,\"maxEmployees\":1}"))
                .andExpect(status().isBadRequest());
        // Duplicate code and version.
        mvc.perform(jsonBody(post(create).with(as(ROOT)), planBody("PRO", "\"planVersion\":1"))).andExpect(status().isConflict());
        // Nothing invalid was stored, and no history entry was written for it.
        assertEquals(0, mongo.count(new Query(Criteria.where("planCode").is("BAD")), PlanHistoryEntry.class));
        assertEquals(1, mongo.count(new Query(Criteria.where("planCode").is("PRO").and("eventType").is(PlanHistoryEventType.PLAN_CREATED)),
                PlanHistoryEntry.class));
    }

    // ==================== 2, 10. nobody else manages plans ====================

    @Test
    void adminsAndUsersCannotCreateEditOrDecidePlans() throws Exception {
        String requestId = requestPlan("sub-admin-a", proId);
        for (String sub : List.of("sub-admin-a", "sub-uma")) {
            mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(sub)), planBody("HACK", ""))).andExpect(status().isForbidden());
            mvc.perform(jsonBody(patch("/api/super-admin/plans/" + proId).with(as(sub)), "{\"name\":\"Mine\"}")).andExpect(status().isForbidden());
            mvc.perform(jsonBody(patch("/api/super-admin/plans/" + proId + "/status").with(as(sub)), "{\"status\":\"INACTIVE\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/plan-history").with(as(sub))).andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/subscriptions").with(as(sub))).andExpect(status().isForbidden());
            mvc.perform(get("/api/super-admin/plan-change-requests").with(as(sub))).andExpect(status().isForbidden());
            mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + requestId + "/approve").with(as(sub)), "{}"))
                    .andExpect(status().isForbidden());
            mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(sub)), "{\"planId\":\"" + proId + "\"}"))
                    .andExpect(status().isForbidden());
        }
        // A USER has no tenant plan routes either.
        mvc.perform(get("/api/tenant/plans").with(as("sub-uma"))).andExpect(status().isForbidden());
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-uma")), "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/plans")).andExpect(status().isUnauthorized());
        // Still exactly as the Super Admin left it.
        mvc.perform(get("/api/super-admin/plans/" + proId).with(as(ROOT)))
                .andExpect(jsonPath("$.name").value("Plan PRO")).andExpect(jsonPath("$.status").value("ACTIVE"));
        assertEquals(PlanChangeRequestStatus.PENDING, mongo.findById(requestId, PlanChangeRequest.class).getStatus());
    }

    // ==================== 3. the Tenant Admin's catalogue ====================

    @Test
    void aTenantAdminSeesEveryPlanButCanRequestOnlyActiveOnesAndNoPlatformData() throws Exception {
        String draft = createPlan(planBody("DRAFTY", "\"publiclyAvailable\":true"));
        mvc.perform(get("/api/tenant/plans").with(as("sub-admin-a")))
                .andExpect(status().isOk())
                // Every plan in the database, whatever its status or public flag…
                .andExpect(jsonPath("$", hasSize(4)))
                .andExpect(jsonPath("$[*].planCode", org.hamcrest.Matchers.containsInAnyOrder("BASIC", "PRO", "HIDDEN", "DRAFTY")))
                // …ACTIVE ones first; only an ACTIVE plan other than the current one can be requested.
                .andExpect(jsonPath("$[3].planCode").value("DRAFTY"))
                .andExpect(jsonPath("$[?(@.planCode=='HIDDEN')].selectable", hasItem(true)))
                .andExpect(jsonPath("$[?(@.planCode=='DRAFTY')].status", hasItem("DRAFT")))
                .andExpect(jsonPath("$[?(@.planCode=='DRAFTY')].selectable", hasItem(false)))
                .andExpect(jsonPath("$[?(@.planCode=='BASIC')].current", hasItem(true)))
                .andExpect(jsonPath("$[?(@.planCode=='BASIC')].selectable", hasItem(false)))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].selectable", hasItem(true)))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].maxUsers", hasItem(25)))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].durationMonths", hasItem(12)))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].modules[*]", org.hamcrest.Matchers.contains("FACTURAFLOW", "JORNADAPULSE")))
                // Platform-only data is not there.
                .andExpect(jsonPath("$[0].createdBy").doesNotExist())
                .andExpect(jsonPath("$[0].currentSubscriptions").doesNotExist())
                .andExpect(jsonPath("$[0].defaultPlan").doesNotExist())
                .andExpect(jsonPath("$[0].publiclyAvailable").doesNotExist());
        mvc.perform(get("/api/tenant/plans/" + proId).with(as("sub-admin-a"))).andExpect(jsonPath("$.planCode").value("PRO"));
        mvc.perform(get("/api/tenant/plans/" + hiddenId).with(as("sub-admin-a"))).andExpect(jsonPath("$.selectable").value(true));
        mvc.perform(get("/api/tenant/plans/" + draft).with(as("sub-admin-a")))
                .andExpect(jsonPath("$.status").value("DRAFT")).andExpect(jsonPath("$.selectable").value(false));
        mvc.perform(get("/api/tenant/plans/000000000000000000000000").with(as("sub-admin-a"))).andExpect(status().isNotFound());
        // A plan that is not ACTIVE cannot be requested.
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + draft + "\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.message", containsString("ACTIVE")));
        assertEquals(0, mongo.count(new Query(), PlanChangeRequest.class));
        // The organization's own subscription, with its dates — and only its own.
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.tenantId").value(tenantA))
                .andExpect(jsonPath("$.startDate").exists())
                .andExpect(jsonPath("$.status").value("ACTIVE"));
        mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/package").with(as("sub-admin-a"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/subscriptions?planId=" + proId).with(as("sub-admin-a"))).andExpect(status().isForbidden());
    }

    // ==================== 4, 5, 9. requests for the own tenant only ====================

    @Test
    void aTenantAdminRequestsAChangeForTheirOwnOrganizationOnly() throws Exception {
        // A tenantId in the body is ignored: the request is for the caller's own organization.
        String body = mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")),
                        "{\"planId\":\"" + proId + "\",\"tenantId\":\"" + tenantB + "\",\"reason\":\"More users\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.organization.id").value(tenantA))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.currentPlan.planCode").value("BASIC"))
                .andExpect(jsonPath("$.requestedPlan.planCode").value("PRO"))
                .andExpect(jsonPath("$.requestedBy.email").value("admin@a.test"))
                .andExpect(jsonPath("$.reason").value("More users"))
                .andReturn().getResponse().getContentAsString();
        String id = json(body, "$.id");
        PlanChangeRequest stored = mongo.findById(id, PlanChangeRequest.class);
        assertEquals(tenantA, stored.getTenantId());
        assertTrue(stored.getOpen());

        // The history entry and the audit event were saved with it.
        PlanHistoryEntry entry = mongo.findOne(new Query(Criteria.where("eventType").is(PlanHistoryEventType.PLAN_CHANGE_REQUESTED)),
                PlanHistoryEntry.class);
        assertNotNull(entry);
        assertEquals(tenantA, entry.getTenantId());
        assertEquals("BASIC", entry.getPreviousPlanCode());
        assertEquals(proId, entry.getPlanId());
        assertEquals(id, entry.getCorrelationId());
        assertEquals("ADMIN", entry.getActorRole());
        assertEquals("More users", entry.getReason());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.PLAN_CHANGE_REQUESTED).and("tenantId").is(tenantA)
                .and("targetId").is(id)), AuditEvent.class));

        // The package is unchanged until a Super Admin approves: no payment was taken.
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(jsonPath("$.plan.planCode").value("BASIC"));

        // Another organization neither sees nor touches it, by list or by id.
        mvc.perform(get("/api/tenant/plan-change-requests").with(as("sub-admin-b"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/tenant/plan-change-requests/" + id).with(as("sub-admin-b"))).andExpect(status().isNotFound());
        mvc.perform(post("/api/tenant/plan-change-requests/" + id + "/cancel").with(as("sub-admin-b"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/tenant/plan-change-requests").with(as("sub-admin-a"))).andExpect(jsonPath("$.totalElements").value(1));

        // One open request at a time; not the current plan; only an ACTIVE plan; a plan id that exists.
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/tenant/plan-change-requests/" + id + "/cancel").with(as("sub-admin-a")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(post("/api/tenant/plan-change-requests/" + id + "/cancel").with(as("sub-admin-a"))).andExpect(status().isConflict());
        String basicId = json(mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andReturn().getResponse().getContentAsString(),
                "$.plan.planId");
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + basicId + "\"}"))
                .andExpect(status().isConflict());
        setStatus(hiddenId, "INACTIVE");
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + hiddenId + "\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"000000000000000000000000\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{}")).andExpect(status().isBadRequest());
        assertEquals(1, history(PlanHistoryEventType.PLAN_CHANGE_CANCELLED, tenantA));
        assertEquals(0, mongo.count(new Query(Criteria.where("tenantId").is(tenantB)), PlanChangeRequest.class));
    }

    // ==================== 6. the email follows the saved request ====================

    @Test
    void theSuperAdminsAreEmailedOnlyAfterTheRequestIsSaved() throws Exception {
        when(emailSender.configured()).thenReturn(true);
        doAnswer(invocation -> {
            // At the moment of sending, the request is already in the database.
            assertEquals(1, mongo.count(new Query(Criteria.where("tenantId").is(tenantA).and("status").is(PlanChangeRequestStatus.PENDING)),
                    PlanChangeRequest.class));
            assertEquals(1, history(PlanHistoryEventType.PLAN_CHANGE_REQUESTED, tenantA));
            return null;
        }).when(emailSender).send(anyList(), anyString(), anyString());

        String body = mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")),
                        "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.notification.status").value("SENT"))
                .andReturn().getResponse().getContentAsString();
        String id = json(body, "$.id");
        // Every detail of the request: organization, requester, both plans with their terms, time, status, reason.
        verify(emailSender, times(1)).send(argThat(to -> to.contains(ROOT + "@platform.example")),
                contains("Org alpha"), argThat(text -> text.contains("admin@a.test") && text.contains("Plan PRO") && text.contains("PENDING")
                        && text.contains(tenantA) && text.contains(id) && text.contains("Subdomain: alpha")
                        && text.contains("Price: 49.90 EUR / MONTHLY") && text.contains("Price: 0.00 EUR / MONTHLY")
                        && text.contains("Duration: 12 months") && text.contains("User seats: 25")
                        && text.contains("Modules: FACTURAFLOW, JORNADAPULSE") && text.contains("Requested at:")
                        && text.contains("Role: ADMIN")));
        OutboundEmail email = mongo.findOne(new Query(Criteria.where("referenceId").is(id)), OutboundEmail.class);
        assertEquals(OutboundEmailStatus.SENT, email.getStatus());

        // A request that is refused (another one is open) is not saved and not announced.
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isConflict());
        String draft = createPlan(planBody("DRAFTY", ""));
        mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-b")), "{\"planId\":\"" + draft + "\"}"))
                .andExpect(status().isConflict());
        verify(emailSender, times(1)).send(anyList(), anyString(), anyString());
        assertEquals(1, mongo.count(new Query(), OutboundEmail.class));
    }

    // ==================== 7. an email failure loses nothing ====================

    @Test
    void anEmailFailureNeverLosesTheSavedRequestOrItsHistory() throws Exception {
        when(emailSender.configured()).thenReturn(true);
        doThrow(new MailSendException("SMTP server unreachable")).when(emailSender).send(anyList(), anyString(), anyString());

        String id = json(mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")),
                        "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.notification.status").value("PENDING"))
                // A Tenant Admin sees the delivery state, not the mail server's error.
                .andExpect(jsonPath("$.notification.lastError").doesNotExist())
                .andReturn().getResponse().getContentAsString(), "$.id");
        assertEquals(PlanChangeRequestStatus.PENDING, mongo.findById(id, PlanChangeRequest.class).getStatus());
        assertEquals(1, history(PlanHistoryEventType.PLAN_CHANGE_REQUESTED, tenantA));
        OutboundEmail email = mongo.findOne(new Query(Criteria.where("referenceId").is(id)), OutboundEmail.class);
        assertEquals(OutboundEmailStatus.PENDING, email.getStatus());
        assertEquals(1, email.getAttempts());
        assertTrue(email.getLastError().contains("SMTP server unreachable"));
        assertNotNull(email.getNextAttemptAt());
        mvc.perform(get("/api/super-admin/plan-change-requests/" + id).with(as(ROOT)))
                .andExpect(jsonPath("$.notification.attempts").value(1))
                .andExpect(jsonPath("$.notification.lastError", containsString("SMTP server unreachable")));

        // With no mail server configured at all, the email waits and the request is recorded as usual.
        when(emailSender.configured()).thenReturn(false);
        String other = requestPlan("sub-admin-b", proId);
        OutboundEmail waiting = mongo.findOne(new Query(Criteria.where("referenceId").is(other)), OutboundEmail.class);
        assertEquals(OutboundEmailStatus.PENDING, waiting.getStatus());
        assertEquals(0, waiting.getAttempts());
        assertTrue(waiting.getLastError().contains("not configured"));
        verify(emailSender, times(1)).send(anyList(), anyString(), anyString());
    }

    // ==================== approval, rejection ====================

    @Test
    void approvingAppliesThePlanAndRecordsEveryStep() throws Exception {
        String id = requestPlan("sub-admin-a", proId);
        mvc.perform(get("/api/super-admin/plan-change-requests?status=PENDING").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].organization.name").value("Org alpha"));

        Instant before = Instant.now().minusSeconds(5);
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/approve").with(as(ROOT)), "{\"note\":\"Welcome to PRO\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.decidedBy").value(rootId))
                .andExpect(jsonPath("$.decisionNote").value("Welcome to PRO"))
                .andExpect(jsonPath("$.appliedSubscriptionId").exists());
        String packageBody = mvc.perform(get("/api/tenant/package").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.plan.planCode").value("PRO"))
                .andExpect(jsonPath("$.plan.maxUsers").value(25))
                .andReturn().getResponse().getContentAsString();
        // A 12-month plan sets the end of the committed term.
        Instant start = Instant.parse(json(packageBody, "$.startDate"));
        Instant end = Instant.parse(json(packageBody, "$.currentPeriodEnd"));
        assertEquals(start.atZone(ZoneOffset.UTC).plusMonths(12).toInstant().truncatedTo(ChronoUnit.SECONDS), end.truncatedTo(ChronoUnit.SECONDS));
        assertFalse(mongo.findById(id, PlanChangeRequest.class).getOpen());

        // Plan history: requested, approved and changed, tied together by the request id.
        mvc.perform(get("/api/super-admin/plan-history?tenantId=" + tenantA).with(as(ROOT)))
                .andExpect(jsonPath("$.content[*].eventType", hasItem("PLAN_CHANGE_REQUESTED")))
                .andExpect(jsonPath("$.content[*].eventType", hasItem("PLAN_CHANGE_APPROVED")))
                .andExpect(jsonPath("$.content[*].eventType", hasItem("TENANT_PLAN_CHANGED")))
                .andExpect(jsonPath("$.content[*].correlationId", everyItem(is(id))));
        PlanHistoryEntry changed = mongo.findOne(new Query(Criteria.where("eventType").is(PlanHistoryEventType.TENANT_PLAN_CHANGED)),
                PlanHistoryEntry.class);
        assertEquals("BASIC", changed.getPreviousPlanCode());
        assertEquals("PRO", changed.getPlanCode());
        assertEquals("SUBSCRIPTION", changed.getReferenceType());
        assertTrue(changed.getOccurredAt().isAfter(before));
        // The subscription history of the organization has it too.
        assertTrue(mongo.exists(new Query(Criteria.where("tenantId").is(tenantA).and("eventType").is("PLAN_CHANGED")), SubscriptionHistory.class));
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.PLAN_CHANGE_APPROVED).and("tenantId").is(tenantA)),
                AuditEvent.class));

        // Decided once only.
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/approve").with(as(ROOT)), "{}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/reject").with(as(ROOT)), "{\"note\":\"No\"}"))
                .andExpect(status().isConflict());
        assertEquals(1, mongo.count(new Query(Criteria.where("tenantId").is(tenantA).and("current").is(true)), TenantSubscription.class));
    }

    @Test
    void rejectingNeedsANoteAndChangesNothing() throws Exception {
        String id = requestPlan("sub-admin-a", proId);
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/reject").with(as(ROOT)), "{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/reject").with(as(ROOT)), "{\"note\":\"Contact sales first\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.decisionNote").value("Contact sales first"));
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(jsonPath("$.plan.planCode").value("BASIC"));
        mvc.perform(get("/api/tenant/plan-change-requests/" + id).with(as("sub-admin-a")))
                .andExpect(jsonPath("$.status").value("REJECTED")).andExpect(jsonPath("$.decisionNote").value("Contact sales first"));
        assertEquals(1, history(PlanHistoryEventType.PLAN_CHANGE_REJECTED, tenantA));
        assertEquals(0, history(PlanHistoryEventType.TENANT_PLAN_CHANGED, tenantA));
        // The organization may ask again.
        requestPlan("sub-admin-a", proId);
    }

    @Test
    void anApprovalThatCannotBeAppliedLeavesTheRequestPendingAndRecordsNothing() throws Exception {
        String id = requestPlan("sub-admin-a", proId);
        setStatus(proId, "INACTIVE");
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/approve").with(as(ROOT)), "{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("ACTIVE")));
        PlanChangeRequest stored = mongo.findById(id, PlanChangeRequest.class);
        assertEquals(PlanChangeRequestStatus.PENDING, stored.getStatus());
        assertTrue(stored.getOpen());
        assertEquals(0, history(PlanHistoryEventType.PLAN_CHANGE_APPROVED, tenantA));
        assertEquals(0, history(PlanHistoryEventType.TENANT_PLAN_CHANGED, tenantA));
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(jsonPath("$.plan.planCode").value("BASIC"));
        // Once the plan is offered again, the same request can be approved.
        setStatus(proId, "ACTIVE");
        mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + id + "/approve").with(as(ROOT)), "{}"))
                .andExpect(status().isOk());
    }

    // ==================== 14. deactivating a plan keeps the past ====================

    @Test
    void deactivatingAPlanKeepsItsSubscriptionsAndAllHistory() throws Exception {
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)),
                        "{\"planId\":\"" + proId + "\",\"reason\":\"Sales deal\"}"))
                .andExpect(status().isOk());
        long subscriptionHistory = mongo.count(new Query(Criteria.where("tenantId").is(tenantA)), SubscriptionHistory.class);
        long planHistory = mongo.count(new Query(), PlanHistoryEntry.class);

        setStatus(proId, "INACTIVE");

        mvc.perform(get("/api/super-admin/subscriptions?planId=" + proId).with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].organization.id").value(tenantA));
        mvc.perform(get("/api/super-admin/plans/" + proId).with(as(ROOT)))
                .andExpect(jsonPath("$.status").value("INACTIVE")).andExpect(jsonPath("$.currentSubscriptions").value(1));
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(jsonPath("$.plan.planCode").value("PRO"));
        // The organization still sees its (now inactive) plan to explain its subscription, but cannot pick it.
        mvc.perform(get("/api/tenant/plans").with(as("sub-admin-a")))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].status", hasItem("INACTIVE")))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].current", hasItem(true)))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].selectable", hasItem(false)));
        // Another organization sees it too, as INACTIVE: listed, not requestable.
        mvc.perform(get("/api/tenant/plans").with(as("sub-admin-b")))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].current", hasItem(false)))
                .andExpect(jsonPath("$[?(@.planCode=='PRO')].selectable", hasItem(false)));
        assertEquals(subscriptionHistory, mongo.count(new Query(Criteria.where("tenantId").is(tenantA)), SubscriptionHistory.class));
        assertEquals(planHistory + 1, mongo.count(new Query(), PlanHistoryEntry.class));
        assertTrue(mongo.exists(new Query(Criteria.where("id").is(proId)), com.NormaOne.backend.model.plans.PlanDefinition.class));
    }

    @Test
    void thePlanHistoryFiltersByEventTenantActorAndDate() throws Exception {
        requestPlan("sub-admin-a", proId);
        String adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        mvc.perform(get("/api/super-admin/plan-history?eventType=PLAN_CREATED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].tenantId").isEmpty());
        mvc.perform(get("/api/super-admin/plan-history?actorUserId=" + adminA).with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].eventType").value("PLAN_CHANGE_REQUESTED"));
        mvc.perform(get("/api/super-admin/plan-history?tenantId=" + tenantB).with(as(ROOT))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/super-admin/plan-history?from=" + Instant.now().plusSeconds(3600)).with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/super-admin/plan-history?to=" + Instant.now().plusSeconds(60) + "&size=2").with(as(ROOT)))
                .andExpect(jsonPath("$.content", hasSize(2)))
                .andExpect(jsonPath("$.totalPages").value(org.hamcrest.Matchers.greaterThan(1)));
        mvc.perform(get("/api/super-admin/plan-history?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z").with(as(ROOT)))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/super-admin/plan-history?eventType=RENAMED").with(as(ROOT))).andExpect(status().isBadRequest());
        verify(emailSender, never()).send(any(), any(), any());
    }
}
