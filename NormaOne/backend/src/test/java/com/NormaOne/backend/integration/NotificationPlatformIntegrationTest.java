package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;

import org.bson.Document;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;

/**
 * Notifications sent by a Super Admin into one named tenant, followed from creation through every
 * member's own read state to archiving; and the recipient lookup an administrator uses to address
 * a SELECTED notification.
 */
class NotificationPlatformIntegrationTest extends NotificationTestBase {

    private String selectedFor(String sub, String id) throws Exception {
        return mvc.perform(get("/api/notifications/" + id).with(as(sub))).andReturn().getResponse().getContentAsString();
    }

    @Test
    void aSuperAdminsNotificationsReachExactlyTheirRecipientsInTheNamedTenant() throws Exception {
        String ana = member(tenantA, "ana");
        String ben = member(tenantA, "ben");
        member(tenantB, "bea");

        String contract = sendAsSuperAdmin(tenantA, selected("Contract", ana, ben));
        String maintenance = sendAsSuperAdmin(tenantA, broadcast("Maintenance"));

        // Stored in tenant A only, created by the platform, each recipient unread with no readAt.
        Document stored = raw(contract);
        assertEquals(tenantA, stored.getString("tenantId"));
        assertEquals("SUPER_ADMIN", stored.getString("createdByRole"));
        assertEquals(userIdOf(ROOT), stored.getString("createdByDocsId"));
        List<Document> users = stored.getList("users", Document.class);
        assertEquals(2, users.size());
        assertTrue(users.stream().allMatch(u -> Boolean.FALSE.equals(u.getBoolean("readStatus")) && u.containsKey("readAt") && u.get("readAt") == null));
        assertTrue(raw(maintenance).getList("users", Document.class).isEmpty());
        assertTrue(mongo.exists(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_CREATED).and("targetId").is(contract)
                .and("tenantId").is(tenantA).and("actorRole").is("SUPER_ADMIN")), AuditEvent.class));

        // Who sees what: the two recipients see both; the tenant's admin only the broadcast; tenant B nothing.
        for (String sub : new String[] {"ana", "ben"}) {
            mvc.perform(get("/api/notifications").with(as(sub))).andExpect(jsonPath("$.totalElements").value(2));
            mvc.perform(get("/api/notifications/unread-count").with(as(sub))).andExpect(jsonPath("$.unreadCount").value(2));
        }
        mvc.perform(get("/api/notifications").with(as(ADMIN_A)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(maintenance));
        mvc.perform(get("/api/notifications").with(as("bea"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications/" + contract).with(as("bea"))).andExpect(status().isNotFound());
        markRead("bea", contract, true).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/" + contract).with(as(ADMIN_A))).andExpect(status().isNotFound());

        // Ana reads both; the first readAt is kept on a repeat; Ben's copies stay unread.
        markRead("ana", contract, true).andExpect(status().isOk()).andExpect(jsonPath("$.readStatus").value(true));
        String firstReadAt = json(selectedFor("ana", contract), "$.readAt");
        assertNotNull(firstReadAt);
        markRead("ana", contract, true).andExpect(jsonPath("$.readAt").value(firstReadAt));
        markRead("ana", maintenance, true).andExpect(status().isOk());
        mvc.perform(get("/api/notifications/unread-count").with(as("ana"))).andExpect(jsonPath("$.unreadCount").value(0));
        mvc.perform(get("/api/notifications?filter=READ").with(as("ana"))).andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/notifications?filter=UNREAD").with(as("ana"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications/unread-count").with(as("ben"))).andExpect(jsonPath("$.unreadCount").value(2));
        mvc.perform(get("/api/notifications?filter=UNREAD").with(as("ben")))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(contract, maintenance)));

        // The Super Admin sees per-recipient state and the broadcast's counts.
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/" + contract).with(as(ROOT)))
                .andExpect(jsonPath("$.readCount").value(1))
                .andExpect(jsonPath("$.users[?(@.userId=='" + ana + "')].readStatus").value(true))
                .andExpect(jsonPath("$.users[?(@.userId=='" + ben + "')].readStatus").value(false));
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/" + maintenance).with(as(ROOT)))
                .andExpect(jsonPath("$.readCount").value(1))
                // admin-a, ana and ben were members when it was sent.
                .andExpect(jsonPath("$.eligibleCount").value(3));

        // Unread again: Ana's own copy only, readAt cleared.
        markRead("ana", contract, false).andExpect(jsonPath("$.readStatus").value(false)).andExpect(jsonPath("$.readAt").value(nullValue()));
        mvc.perform(get("/api/notifications/unread-count").with(as("ana"))).andExpect(jsonPath("$.unreadCount").value(1));
        Document ben0 = raw(contract).getList("users", Document.class).stream()
                .filter(u -> ben.equals(u.getString("userId"))).findFirst().orElseThrow();
        assertNull(ben0.get("readAt"));

        // The tenant's administrator may read it but not change or archive it; the Super Admin may.
        mvc.perform(get("/api/tenant/notifications/" + contract).with(as(ADMIN_A))).andExpect(status().isOk());
        patchJson("/api/tenant/notifications/" + contract + "/status", ADMIN_A, "{\"status\":\"ARCHIVED\"}").andExpect(status().isForbidden());
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + contract + "/status", ROOT,
                "{\"status\":\"ARCHIVED\",\"reason\":\"Superseded\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"));
        // Archived: gone from inboxes and counts, kept for administrators, not editable, archiving again changes nothing.
        mvc.perform(get("/api/notifications/" + contract).with(as("ben"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/unread-count").with(as("ben"))).andExpect(jsonPath("$.unreadCount").value(1));
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications?status=ARCHIVED").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/tenant/notifications/" + contract).with(as(ADMIN_A))).andExpect(jsonPath("$.status").value("ARCHIVED"));
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + contract, ROOT, "{\"subject\":\"Late\"}")
                .andExpect(status().isConflict());
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + contract + "/status", ROOT, "{\"status\":\"ARCHIVED\"}")
                .andExpect(status().isOk());
        assertEquals(1, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_ARCHIVED).and("targetId").is(contract)),
                AuditEvent.class));

        // A notification of tenant A is not reachable through tenant B's route.
        mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/notifications/" + maintenance).with(as(ROOT))).andExpect(status().isNotFound());
        // A member of B cannot be a recipient in A, and an empty SELECTED list never becomes a broadcast.
        postJson("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT, selected("Cross", userIdOf("bea")))
                .andExpect(status().isBadRequest());
        postJson("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT,
                "{\"subject\":\"S\",\"body\":\"B\",\"audience\":\"SELECTED\",\"userIds\":[]}")
                .andExpect(status().isBadRequest());
        // A platform account is never a recipient: it has no tenant.
        postJson("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT, selected("To myself", userIdOf(ROOT)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void recipientsAreTheEligibleMembersOfTheOneTenant() throws Exception {
        String ana = member(tenantA, "ana");
        String ivy = member(tenantA, "ivy", UserRole.USER, UserStatus.INVITED);
        member(tenantA, "sam", UserRole.USER, UserStatus.SUSPENDED);
        member(tenantA, "dee", UserRole.USER, UserStatus.DEACTIVATED);
        member(tenantB, "bea");
        String adminA = userIdOf(ADMIN_A);

        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/recipients").with(as(ROOT)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(adminA, ana, ivy)))
                .andExpect(jsonPath("$.content[*].cognitoSub").isEmpty());
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/recipients?search=IVY").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].status").value("INVITED"))
                .andExpect(jsonPath("$.content[0].role").value("USER"));
        mvc.perform(get("/api/tenant/notifications/recipients").with(as(ADMIN_A)))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(adminA, ana, ivy)));
        mvc.perform(get("/api/tenant/notifications/recipients").with(as(ADMIN_B)))
                .andExpect(jsonPath("$.content[*].id", containsInAnyOrder(userIdOf(ADMIN_B), userIdOf("bea"))));
        mvc.perform(get("/api/super-admin/tenants/000000000000000000000000/notifications/recipients").with(as(ROOT)))
                .andExpect(status().isNotFound());

        // Any administrator of the tenant can look recipients up and address a notification to them.
        member(tenantA, "notifier", UserRole.ADMIN, UserStatus.ACTIVE);
        String found = json(mvc.perform(get("/api/tenant/notifications/recipients?search=ana").with(as("notifier")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(), "$.content[0].id");
        assertEquals(ana, found);
        postJson("/api/tenant/notifications", "notifier", selected("Hi", found)).andExpect(status().isCreated());

        // Without the role there is no lookup — whatever an old document's general permission list says.
        mongo.updateFirst(new Query(Criteria.where("cognitoSub").is("ana")),
                new Update().set("permissions", List.of("NOTIFICATIONS_MANAGE", "USERS_VIEW")), user.class);
        mvc.perform(get("/api/tenant/notifications/recipients").with(as("ana"))).andExpect(status().isForbidden());
        member(tenantA, "inactive-admin", UserRole.ADMIN, UserStatus.DEACTIVATED);
        mvc.perform(get("/api/tenant/notifications/recipients").with(as("inactive-admin"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/recipients").with(as(ADMIN_A))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/notifications/recipients").with(as(ROOT))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/notifications/recipients")).andExpect(status().isUnauthorized());
    }
}
