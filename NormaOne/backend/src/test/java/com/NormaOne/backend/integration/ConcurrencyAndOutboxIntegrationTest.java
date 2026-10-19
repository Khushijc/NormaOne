package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.http.MediaType;
import org.springframework.mail.MailSendException;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.OutboundEmail;
import com.NormaOne.backend.model.notification.enums.OutboundEmailStatus;
import com.NormaOne.backend.model.plans.PlanChangeRequest;
import com.NormaOne.backend.model.plans.PlanHistoryEntry;
import com.NormaOne.backend.model.plans.TenantSubscription;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.NormaOne.backend.services.EmailOutboxService;

/**
 * Concurrency and the email outbox: two Super Admins removing each other at once, simultaneous
 * approvals and duplicate submissions of a plan-change request, and the outbox's retries — which
 * resend an email and never re-run the request or the plan change it is about.
 */
class ConcurrencyAndOutboxIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    @Autowired
    private EmailOutboxService outbox;

    @Autowired
    private NormaOneProperties properties;

    private String proId;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        onboard("sub-admin-a", "admin@a.test", "alpha");
        proId = json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"PRO\",\"name\":\"Pro\",\"billingCycle\":\"MONTHLY\",\"listPrice\":49.9,\"maxEmployees\":50}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + proId + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    /** Runs the calls at the same moment and returns their HTTP statuses. */
    private static List<Integer> together(List<Callable<Integer>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        for (Callable<Integer> call : calls) {
            futures.add(pool.submit(() -> {
                start.await();
                return call.call();
            }));
        }
        start.countDown();
        List<Integer> codes = new ArrayList<>();
        for (Future<Integer> future : futures) {
            codes.add(future.get(60, TimeUnit.SECONDS));
        }
        pool.shutdown();
        return codes;
    }

    private long activeSuperAdmins() {
        return mongo.count(new Query(Criteria.where("roles").is("SUPER_ADMIN").and("status").is(UserStatus.ACTIVE)), user.class);
    }

    // ==================== two Super Admins remove each other at once ====================

    @Test
    void twoSuperAdminsRemovingEachOtherAtOnceAlwaysLeaveOneActive() throws Exception {
        for (int round = 0; round < 10; round++) {
            String a = "sub-sa-a" + round;
            String b = "sub-sa-b" + round;
            // Only these two are active this round.
            mongo.updateMulti(new Query(Criteria.where("roles").is("SUPER_ADMIN")), new Update().set("status", UserStatus.DEACTIVATED), user.class);
            String aId = superAdmin(a).getId();
            String bId = superAdmin(b).getId();
            String body = "{\"status\":\"DEACTIVATED\",\"reason\":\"Race\"}";
            List<Integer> codes = together(List.of(
                    () -> mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + bId + "/status").with(as(a)), body))
                            .andReturn().getResponse().getStatus(),
                    () -> mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + aId + "/status").with(as(b)), body))
                            .andReturn().getResponse().getStatus()));
            assertTrue(activeSuperAdmins() >= 1, "round " + round + ": the platform kept an active Super Admin (" + codes + ")");
            long succeeded = codes.stream().filter(code -> code == 200).count();
            assertTrue(succeeded <= 1, "round " + round + ": at most one removal succeeded (" + codes + ")");
            // What the answers said is what the database holds.
            UserStatus aNow = userRepository.findById(aId).orElseThrow().getStatus();
            UserStatus bNow = userRepository.findById(bId).orElseThrow().getStatus();
            assertEquals(codes.get(0) == 200, bNow == UserStatus.DEACTIVATED, "round " + round + ": " + codes);
            assertEquals(codes.get(1) == 200, aNow == UserStatus.DEACTIVATED, "round " + round + ": " + codes);
        }
        assertEquals(0, mongo.count(new Query(), "resource_locks"));
    }

    @Test
    void aSuperAdminRemovedWhileTheirRequestWaitsNoLongerActs() throws Exception {
        String a = superAdmin("sub-sa-a").getId();
        String c = superAdmin("sub-sa-c").getId();
        // Another change holds the platform's Super Admin lock.
        mongo.getCollection("resource_locks").insertOne(new org.bson.Document("_id", "super-admins").append("owner", "someone-else")
                .append("lockedUntil", java.util.Date.from(Instant.now().plusSeconds(30))));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        // sub-sa-a (authenticated and active now) asks to remove sub-sa-c, and waits for the lock.
        Future<Integer> waiting = pool.submit(() -> mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + c + "/status").with(as("sub-sa-a")),
                "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}")).andReturn().getResponse().getStatus());
        Thread.sleep(300);
        // Meanwhile the change holding the lock removes sub-sa-a, then releases the lock.
        mongo.updateFirst(new Query(Criteria.where("id").is(a)), new Update().set("status", UserStatus.DEACTIVATED), user.class);
        mongo.remove(new Query(Criteria.where("_id").is("super-admins")), "resource_locks");
        assertEquals(403, waiting.get(30, TimeUnit.SECONDS), "a removed Super Admin's waiting request is refused");
        pool.shutdown();
        assertEquals(UserStatus.ACTIVE, userRepository.findById(c).orElseThrow().getStatus());
    }

    @Test
    void anExpiredLockLeftByACrashedInstanceDoesNotBlock() throws Exception {
        superAdmin("sub-sa-a");
        String c = superAdmin("sub-sa-c").getId();
        mongo.getCollection("resource_locks").insertOne(new org.bson.Document("_id", "super-admins").append("owner", "crashed")
                .append("lockedUntil", java.util.Date.from(Instant.now().minusSeconds(5))));
        mvc.perform(jsonBody(patch("/api/super-admin/super-admins/" + c + "/status").with(as("sub-sa-a")), "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isOk());
        assertEquals(0, mongo.count(new Query(), "resource_locks"));
    }

    // ==================== plan-change requests: duplicates and double approvals ====================

    @Test
    void aDoubleSubmittedRequestIsSavedAndAnnouncedOnce() throws Exception {
        when(emailSender.configured()).thenReturn(true);
        String body = "{\"planId\":\"" + proId + "\"}";
        List<Callable<Integer>> calls = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            calls.add(() -> mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), body))
                    .andReturn().getResponse().getStatus());
        }
        List<Integer> codes = together(calls);
        assertEquals(1, codes.stream().filter(code -> code == 201).count(), codes.toString());
        assertEquals(3, codes.stream().filter(code -> code == 409).count(), codes.toString());
        assertEquals(1, mongo.count(new Query(), PlanChangeRequest.class));
        assertEquals(1, mongo.count(new Query(Criteria.where("eventType").is(PlanHistoryEventType.PLAN_CHANGE_REQUESTED)), PlanHistoryEntry.class));
        assertEquals(1, mongo.count(new Query(), OutboundEmail.class));
        verify(emailSender, times(1)).send(anyList(), anyString(), anyString());
    }

    @Test
    void simultaneousApprovalsApplyThePlanOnce() throws Exception {
        String requestId = json(mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")),
                        "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        superAdmin("sub-root-2");
        List<Integer> codes = together(List.of(
                () -> mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + requestId + "/approve").with(as(ROOT)), "{}"))
                        .andReturn().getResponse().getStatus(),
                () -> mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + requestId + "/approve").with(as("sub-root-2")), "{}"))
                        .andReturn().getResponse().getStatus(),
                () -> mvc.perform(jsonBody(post("/api/super-admin/plan-change-requests/" + requestId + "/reject").with(as("sub-root-2")),
                        "{\"note\":\"no\"}")).andReturn().getResponse().getStatus()));
        assertEquals(1, codes.stream().filter(code -> code == 200).count(), codes.toString());
        assertEquals(2, codes.stream().filter(code -> code == 409).count(), codes.toString());
        PlanChangeRequest decided = mongo.findById(requestId, PlanChangeRequest.class);
        long changes = mongo.count(new Query(Criteria.where("eventType").is(PlanHistoryEventType.TENANT_PLAN_CHANGED)), PlanHistoryEntry.class);
        if (decided.getStatus() == PlanChangeRequestStatus.APPROVED) {
            assertEquals(1, changes);
            // One current subscription, on PRO; the BASIC one closed once.
            assertEquals(1, mongo.count(new Query(Criteria.where("current").is(true)), TenantSubscription.class));
            assertEquals(2, mongo.count(new Query(), TenantSubscription.class));
        } else {
            assertEquals(PlanChangeRequestStatus.REJECTED, decided.getStatus());
            assertEquals(0, changes);
            assertEquals(1, mongo.count(new Query(), TenantSubscription.class));
        }
    }

    // ==================== the outbox ====================

    private String request() throws Exception {
        return json(mvc.perform(jsonBody(post("/api/tenant/plan-change-requests").with(as("sub-admin-a")), "{\"planId\":\"" + proId + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
    }

    private OutboundEmail emailFor(String requestId) {
        return mongo.findOne(new Query(Criteria.where("referenceId").is(requestId)), OutboundEmail.class);
    }

    /** Makes every PENDING email due now, as if its backoff had passed. */
    private void makeDue() {
        mongo.updateMulti(new Query(Criteria.where("status").is(OutboundEmailStatus.PENDING)),
                new Update().set("nextAttemptAt", Instant.now().minusSeconds(1)), OutboundEmail.class);
    }

    private void assertRequestUntouched(String requestId) {
        assertEquals(1, mongo.count(new Query(), PlanChangeRequest.class));
        assertEquals(PlanChangeRequestStatus.PENDING, mongo.findById(requestId, PlanChangeRequest.class).getStatus());
        assertEquals(1, mongo.count(new Query(Criteria.where("eventType").is(PlanHistoryEventType.PLAN_CHANGE_REQUESTED)), PlanHistoryEntry.class));
        assertEquals(0, mongo.count(new Query(Criteria.where("eventType").is(PlanHistoryEventType.TENANT_PLAN_CHANGED)), PlanHistoryEntry.class));
        assertEquals(1, mongo.count(new Query(), TenantSubscription.class));
    }

    @Test
    void aFailingEmailIsRetriedUpToTheLimitThenFailedAndTheRequestIsKept() throws Exception {
        int max = properties.getEmail().getMaxAttempts();
        when(emailSender.configured()).thenReturn(true);
        doThrow(new MailSendException("SMTP down")).when(emailSender).send(anyList(), anyString(), anyString());
        String requestId = request();                       // attempt 1
        for (int i = 0; i < max + 3; i++) {                 // more retries than allowed
            makeDue();
            outbox.retryDue();
        }
        OutboundEmail email = emailFor(requestId);
        assertEquals(OutboundEmailStatus.FAILED, email.getStatus());
        assertEquals(max, email.getAttempts());
        assertTrue(email.getLastError().contains("SMTP down"));
        verify(emailSender, times(max)).send(anyList(), anyString(), anyString());
        assertRequestUntouched(requestId);
    }

    @Test
    void anEmailWaitingForConfigurationIsSentOnceDeliveryIsConfigured() throws Exception {
        String requestId = request();                       // not configured: waits, nothing attempted
        OutboundEmail waiting = emailFor(requestId);
        assertEquals(OutboundEmailStatus.PENDING, waiting.getStatus());
        assertEquals(0, waiting.getAttempts());
        outbox.retryDue();                                  // still not configured: nothing happens
        verify(emailSender, never()).send(anyList(), anyString(), anyString());

        when(emailSender.configured()).thenReturn(true);
        doNothing().when(emailSender).send(anyList(), anyString(), anyString());
        outbox.retryDue();
        OutboundEmail sent = emailFor(requestId);
        assertEquals(OutboundEmailStatus.SENT, sent.getStatus());
        assertEquals(1, sent.getAttempts());
        assertNotNull(sent.getSentAt());
        // A sent email is never sent again.
        makeDue();
        outbox.retryDue();
        outbox.retryDue();
        verify(emailSender, times(1)).send(anyList(), anyString(), anyString());
        assertRequestUntouched(requestId);
    }

    @Test
    void aFailedAttemptRecoversOnTheNextRetry() throws Exception {
        when(emailSender.configured()).thenReturn(true);
        AtomicInteger calls = new AtomicInteger();
        doAnswer(invocation -> {
            if (calls.incrementAndGet() == 1) {
                throw new MailSendException("Temporary failure");
            }
            return null;
        }).when(emailSender).send(anyList(), anyString(), anyString());
        String requestId = request();
        OutboundEmail first = emailFor(requestId);
        assertEquals(OutboundEmailStatus.PENDING, first.getStatus());
        assertTrue(first.getNextAttemptAt().isAfter(Instant.now()), "the retry waits for its backoff");
        outbox.retryDue();                                  // not due yet: nothing happens
        assertEquals(1, calls.get());
        makeDue();
        outbox.retryDue();
        OutboundEmail recovered = emailFor(requestId);
        assertEquals(OutboundEmailStatus.SENT, recovered.getStatus());
        assertEquals(2, recovered.getAttempts());
        assertEquals(null, recovered.getLastError());
        assertRequestUntouched(requestId);
    }

    @Test
    void retriesRunningAtOnceSendAnEmailOnlyOnce() throws Exception {
        String requestId = request();                       // waits (not configured)
        when(emailSender.configured()).thenReturn(true);
        AtomicInteger sends = new AtomicInteger();
        doAnswer(invocation -> {
            sends.incrementAndGet();
            Thread.sleep(200);                              // a slow mail server: the others overlap it
            return null;
        }).when(emailSender).send(anyList(), anyString(), anyString());
        List<Callable<Integer>> retries = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            retries.add(() -> {
                outbox.retryDue();
                return 0;
            });
        }
        together(retries);
        assertEquals(1, sends.get());
        assertEquals(OutboundEmailStatus.SENT, emailFor(requestId).getStatus());
        assertEquals(1, emailFor(requestId).getAttempts());
        assertRequestUntouched(requestId);
    }
}
