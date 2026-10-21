package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.services.SeatService;

import software.amazon.awssdk.services.cognitoidentityprovider.model.AdminCreateUserRequest;

/**
 * The plan's user-seat limit (maxUsers), enforced on the backend (SeatService).
 *
 *   alpha   sub-admin-a ADMIN (owner) — moved to plan SEATS3 (maxUsers 3)
 *   bravo   sub-admin-b ADMIN (owner) — stays on BASIC (no limit)
 * ACTIVE, INVITED and SUSPENDED accounts take a seat; DEACTIVATED ones do not.
 */
class SeatLimitIntegrationTest extends IntegrationTestBase {

    private static final String ROOT = "sub-root";

    private String tenantA;
    private String tenantB;

    @BeforeEach
    void platform() throws Exception {
        superAdmin(ROOT);
        tenantA = onboard("sub-admin-a", "admin@a.test", "alpha");
        tenantB = onboard("sub-admin-b", "admin@b.test", "bravo");
        String seats3 = json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"SEATS3\",\"name\":\"Three seats\",\"billingCycle\":\"MONTHLY\",\"listPrice\":9,\"maxEmployees\":10,\"maxUsers\":3}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + seats3 + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantA + "/package").with(as(ROOT)), "{\"planId\":\"" + seats3 + "\"}"))
                .andExpect(status().isOk());
    }

    private static MockHttpServletRequestBuilder jsonBody(MockHttpServletRequestBuilder request, String body) {
        return request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String userBody(String name) {
        return "{\"name\":\"" + name + "\",\"email\":\"" + name.toLowerCase() + "@a.test\",\"role\":\"USER\"}";
    }

    private String invite(String name) throws Exception {
        return json(mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), userBody(name)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
    }

    private long seated(String tenantId) {
        return mongo.count(new Query(Criteria.where("tenantId").is(tenantId).and("status").in(SeatService.SEATED)), user.class);
    }

    @Test
    void invitationsTakeSeatsUntilTheLimitAndPendingOnesCount() throws Exception {
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a")))
                .andExpect(jsonPath("$.seats.limit").value(3)).andExpect(jsonPath("$.seats.used").value(1));
        invite("Ana");                       // 2 of 3, a pending invitation
        invite("Ben");                       // 3 of 3
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-a"))).andExpect(jsonPath("$.seats.used").value(3));

        // Full: refused with a clear message, nothing written, no Cognito invitation sent.
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), userBody("Cleo")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("Employee limit reached: the Three seats plan allows 3 employees")))
                .andExpect(jsonPath("$.message", containsString("3 are already added")))
                .andExpect(jsonPath("$.message", containsString("Upgrade your plan")));
        assertTrue(userRepository.findByEmail("cleo@a.test").isEmpty());
        verify(cognito, never()).adminCreateUser(argThat((AdminCreateUserRequest r) -> "cleo@a.test".equals(r.username())));
        // An administrator takes a seat too, whoever invites them.
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), "{\"name\":\"Ivo\",\"email\":\"ivo@a.test\",\"role\":\"ADMIN\"}"))
                .andExpect(status().isConflict());
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)), "{\"tenantId\":\"" + tenantA + "\",\"name\":\"Nora\",\"email\":\"nora@a.test\"}"))
                .andExpect(status().isConflict());
        assertEquals(3, seated(tenantA));
    }

    @Test
    void deactivatingFreesASeatSuspendingDoesNotAndReactivatingNeedsOne() throws Exception {
        String ana = invite("Ana");
        mvc.perform(get("/api/users/me").with(asVerified("sub-ana", "ana@a.test", "Ana"))).andExpect(jsonPath("$.effectiveRole").value("USER"));
        String ben = invite("Ben");          // 3 of 3

        // A suspended account keeps its seat.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ana + "/status").with(as("sub-admin-a")), "{\"status\":\"SUSPENDED\",\"reason\":\"Leave\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), userBody("Cleo"))).andExpect(status().isConflict());
        // Back from SUSPENDED needs no new seat.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ana + "/status").with(as("sub-admin-a")), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk());

        // Revoking a pending invitation (DEACTIVATED) frees its seat for someone else.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ben + "/status").with(as("sub-admin-a")), "{\"status\":\"DEACTIVATED\",\"reason\":\"Not joining\"}"))
                .andExpect(status().isOk());
        String cleo = invite("Cleo");        // 3 of 3 again

        // Reactivating Ben now needs a seat that is not there: refused, Ben stays DEACTIVATED.
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ben + "/status").with(as("sub-admin-a")), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("Upgrade your plan")));
        assertEquals(UserStatus.DEACTIVATED, userRepository.findById(ben).orElseThrow().getStatus());
        // Freeing a seat makes the reactivation possible (a revoked invitation comes back as INVITED).
        mvc.perform(jsonBody(patch("/api/tenant/users/" + cleo + "/status").with(as("sub-admin-a")), "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ben + "/status").with(as("sub-admin-a")), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INVITED"));
        assertEquals(3, seated(tenantA));

        // The Super Admin's reactivation of an administrator follows the same rule.
        String adminA = userRepository.findByCognitoSub("sub-admin-a").orElseThrow().getId();
        mvc.perform(jsonBody(patch("/api/tenant/users/" + ana + "/status").with(as("sub-admin-a")), "{\"status\":\"DEACTIVATED\",\"reason\":\"x\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)),
                        "{\"status\":\"DEACTIVATED\",\"reason\":\"Review\",\"confirmNoActiveAdmin\":true}"))
                .andExpect(status().isOk());
        invite2(tenantA, "Dan");              // 2 of 3: Ben (invited) and Dan
        invite2(tenantA, "Eva");              // 3 of 3
        mvc.perform(jsonBody(patch("/api/super-admin/admins/" + adminA + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isConflict());
        assertEquals(UserStatus.DEACTIVATED, userRepository.findById(adminA).orElseThrow().getStatus());
    }

    /** With the organization's admin deactivated, the Super Admin invites administrators instead. */
    private void invite2(String tenantId, String name) throws Exception {
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)),
                        "{\"tenantId\":\"" + tenantId + "\",\"name\":\"" + name + "\",\"email\":\"" + name.toLowerCase() + "@a.test\"}"))
                .andExpect(status().isCreated());
    }

    @Test
    void theBasicPlanAllowsTenEmployeesAndTheEleventhIsAskedToUpgrade() throws Exception {
        // BASIC sets no seat limit, so its maxEmployees (10) is the limit; the owner is employee 1.
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-b")))
                .andExpect(jsonPath("$.plan.planCode").value("BASIC"))
                .andExpect(jsonPath("$.seats.limit").value(10)).andExpect(jsonPath("$.seats.used").value(1));
        for (int i = 2; i <= 10; i++) {
            mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-b")),
                            "{\"name\":\"U" + i + "\",\"email\":\"u" + i + "@b.test\",\"role\":\"USER\"}"))
                    .andExpect(status().isCreated());
        }
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-b"))).andExpect(jsonPath("$.seats.used").value(10));
        // The 11th employee: refused, with the message to upgrade; nothing is written.
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-b")), "{\"name\":\"U11\",\"email\":\"u11@b.test\",\"role\":\"USER\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("the Basic plan allows 10 employees")))
                .andExpect(jsonPath("$.message", containsString("Upgrade your plan to add more employees")));
        mvc.perform(jsonBody(post("/api/super-admin/admins").with(as(ROOT)), "{\"tenantId\":\"" + tenantB + "\",\"name\":\"Ann\",\"email\":\"ann@b.test\"}"))
                .andExpect(status().isConflict());
        assertTrue(userRepository.findByEmail("u11@b.test").isEmpty());
        assertEquals(10, seated(tenantB));
        mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/package").with(as(ROOT))).andExpect(jsonPath("$.seats.used").value(10));

        // After an upgrade to a plan with more employees, the 11th can be added.
        String bigger = json(mvc.perform(jsonBody(post("/api/super-admin/plans").with(as(ROOT)),
                        "{\"planCode\":\"TEAM\",\"name\":\"Team\",\"billingCycle\":\"MONTHLY\",\"listPrice\":20,\"maxEmployees\":30}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString(), "$.id");
        mvc.perform(jsonBody(patch("/api/super-admin/plans/" + bigger + "/status").with(as(ROOT)), "{\"status\":\"ACTIVE\"}")).andExpect(status().isOk());
        mvc.perform(jsonBody(put("/api/super-admin/tenants/" + tenantB + "/package").with(as(ROOT)), "{\"planId\":\"" + bigger + "\"}"))
                .andExpect(status().isOk());
        mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-b")), "{\"name\":\"U11\",\"email\":\"u11@b.test\",\"role\":\"USER\"}"))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/tenant/package").with(as("sub-admin-b")))
                .andExpect(jsonPath("$.seats.limit").value(30)).andExpect(jsonPath("$.seats.used").value(11));
    }

    @Test
    void simultaneousInvitationsNeverExceedTheLimit() throws Exception {
        invite("Ana");                       // 2 of 3: one seat left
        int attempts = 6;
        ExecutorService pool = Executors.newFixedThreadPool(attempts);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> results = new ArrayList<>();
        for (int i = 0; i < attempts; i++) {
            String body = "{\"name\":\"Racer" + i + "\",\"email\":\"racer" + i + "@a.test\",\"role\":\"USER\"}";
            results.add(pool.submit(() -> {
                start.await();
                return mvc.perform(jsonBody(post("/api/tenant/users").with(as("sub-admin-a")), body)).andReturn().getResponse().getStatus();
            }));
        }
        start.countDown();
        int created = 0;
        int refused = 0;
        for (Future<Integer> result : results) {
            int code = result.get(60, TimeUnit.SECONDS);
            if (code == 201) {
                created++;
            } else if (code == 409) {
                refused++;
            }
        }
        pool.shutdown();
        assertEquals(1, created, "exactly the one free seat was given out");
        assertEquals(attempts - 1, refused);
        assertEquals(3, seated(tenantA));
        // No lock is left behind.
        assertEquals(0, mongo.count(new Query(), "resource_locks"));
    }
}
