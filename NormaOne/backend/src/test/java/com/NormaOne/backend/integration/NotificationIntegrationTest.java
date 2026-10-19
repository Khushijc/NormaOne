package com.NormaOne.backend.integration;

import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.bson.Document;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import com.NormaOne.backend.dto.notification.UpdateNotificationRequest;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.model.notification.NotificationReceipt;
import com.NormaOne.backend.services.NotificationInboxService;
import com.NormaOne.backend.services.NotificationService;

/**
 * The notification module end to end: who may send, to whom, what each member sees, and how each
 * member's read state stays their own. Attachments are covered in NotificationAttachmentIntegrationTest.
 */
class NotificationIntegrationTest extends NotificationTestBase {

    @Autowired
    private NotificationInboxService inboxService;

    @Autowired
    private NotificationService notificationService;

    // ==================== 1. selected recipients ====================

    @Test
    void tenantAdminSendsToSelectedMembersWithFreshReadStates() throws Exception {
        String uma = member(tenantA, "uma");
        String luis = member(tenantA, "luis");

        // A users array with read states, a duplicate id and another tenant's id in the body are not taken.
        String body = "{\"subject\":\"Important Compliance Update\",\"body\":\"Please review the updated requirements.\","
                + "\"audience\":\"SELECTED\",\"userIds\":[\"" + uma + "\",\"" + luis + "\",\"" + uma + "\"],"
                + "\"users\":[{\"userId\":\"" + uma + "\",\"readStatus\":true,\"readAt\":\"2026-01-01T00:00:00Z\"}],"
                + "\"tenantId\":\"" + tenantB + "\",\"createdByRole\":\"SUPER_ADMIN\"}";
        String response = postJson("/api/tenant/notifications", ADMIN_A, body)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.tenantId").value(tenantA))
                .andExpect(jsonPath("$.audience").value("SELECTED"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.createdByRole").value("ADMIN"))
                .andExpect(jsonPath("$.createdBy").value(userIdOf(ADMIN_A)))
                .andExpect(jsonPath("$.recipientCount").value(2))
                .andExpect(jsonPath("$.readCount").value(0))
                .andExpect(jsonPath("$.users[*].userId", containsInAnyOrder(uma, luis)))
                .andExpect(jsonPath("$.users[*].readStatus", containsInAnyOrder(false, false)))
                .andReturn().getResponse().getContentAsString();
        String id = json(response, "$.id");

        // Stored exactly as {userId, readStatus: false, readAt: null}, in the caller's tenant.
        Document doc = raw(id);
        assertEquals(tenantA, doc.getString("tenantId"));
        assertEquals("SELECTED", doc.getString("audience"));
        assertEquals("ACTIVE", doc.getString("recordState"));
        assertTrue(doc.containsKey("attachment"));
        assertNull(doc.get("attachment"));
        List<Document> users = doc.getList("users", Document.class);
        assertEquals(2, users.size());
        for (Document recipient : users) {
            assertEquals(Set.of("userId", "readStatus", "readAt"), recipient.keySet());
            assertEquals(Boolean.FALSE, recipient.get("readStatus"));
            assertNull(recipient.get("readAt"));
        }

        // Audited without the body.
        List<AuditEvent> events = mongo.find(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_CREATED)), AuditEvent.class);
        assertEquals(1, events.size());
        assertEquals("SELECTED", events.get(0).getDetails().get("audience"));
        assertEquals("2", events.get(0).getDetails().get("recipientCount"));
        assertFalse(events.get(0).getDetails().toString().contains("Please review"));

        // Both recipients see it; another member of the tenant does not.
        String outsider = member(tenantA, "outsider");
        assertNotNull(outsider);
        mvc.perform(get("/api/notifications").with(as("uma")))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(id))
                .andExpect(jsonPath("$.content[0].readStatus").value(false))
                .andExpect(jsonPath("$.content[0].users").doesNotExist());
        mvc.perform(get("/api/notifications").with(as("outsider"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications/" + id).with(as("outsider"))).andExpect(status().isNotFound());
    }

    // ==================== 2. tenant-wide broadcast ====================

    @Test
    void tenantAdminBroadcastsToTheirOwnTenantOnly() throws Exception {
        member(tenantA, "ana");
        member(tenantA, "ben");
        member(tenantB, "bea");
        String id = sendAsTenantAdmin(ADMIN_A, broadcast("Office closed Friday"));

        Document doc = raw(id);
        assertEquals("TENANT", doc.getString("audience"));
        assertTrue(doc.getList("users", Document.class).isEmpty());
        assertEquals(tenantA, doc.getString("tenantId"));

        for (String sub : List.of("ana", "ben", ADMIN_A)) {
            mvc.perform(get("/api/notifications").with(as(sub)))
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content[0].audience").value("TENANT"));
        }
        mvc.perform(get("/api/notifications").with(as("bea"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications").with(as(ADMIN_B))).andExpect(jsonPath("$.totalElements").value(0));

        // Admin view: no recipient list, counts instead (owner + ana + ben).
        mvc.perform(get("/api/tenant/notifications/" + id).with(as(ADMIN_A)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.users", hasSize(0)))
                .andExpect(jsonPath("$.readCount").value(0))
                .andExpect(jsonPath("$.eligibleCount").value(3));
    }

    // ==================== 3. Super Admin picks a tenant ====================

    @Test
    void superAdminSendsIntoTheTenantInTheRoute() throws Exception {
        member(tenantA, "ana");
        String bea = member(tenantB, "bea");
        String toB = sendAsSuperAdmin(tenantB, broadcast("Planned maintenance"));
        String toBea = sendAsSuperAdmin(tenantB, selected("Your contract", bea));

        assertEquals(tenantB, raw(toB).getString("tenantId"));
        assertEquals("SUPER_ADMIN", raw(toB).getString("createdByRole"));
        mvc.perform(get("/api/notifications").with(as("bea")))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[*].createdByRole", containsInAnyOrder("SUPER_ADMIN", "SUPER_ADMIN")));
        mvc.perform(get("/api/notifications").with(as("ana"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/super-admin/tenants/" + tenantB + "/notifications").with(as(ROOT)))
                .andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications/" + toBea).with(as(ROOT)))
                .andExpect(status().isNotFound());

        // An unknown tenant is not found; a suspended one cannot be sent to.
        postJson("/api/super-admin/tenants/000000000000000000000000/notifications", ROOT, broadcast("x"))
                .andExpect(status().isNotFound());
        mongo.updateFirst(new Query(Criteria.where("id").is(tenantB)), new Update().set("status", TenantStatus.SUSPENDED), Tenant.class);
        postJson("/api/super-admin/tenants/" + tenantB + "/notifications", ROOT, broadcast("x"))
                .andExpect(status().isConflict());
    }

    // ==================== 4. empty recipients are never platform-wide ====================

    @Test
    void anEmptyRecipientListNeverBecomesAPlatformBroadcast() throws Exception {
        String uma = member(tenantA, "uma");
        postJson("/api/tenant/notifications", ADMIN_A, "{\"subject\":\"s\",\"body\":\"b\",\"audience\":\"SELECTED\",\"userIds\":[]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("at least one recipient")));
        postJson("/api/tenant/notifications", ADMIN_A, "{\"subject\":\"s\",\"body\":\"b\",\"audience\":\"SELECTED\"}")
                .andExpect(status().isBadRequest());
        postJson("/api/tenant/notifications", ADMIN_A, "{\"subject\":\"s\",\"body\":\"b\",\"audience\":\"TENANT\",\"userIds\":[\"" + uma + "\"]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("takes no userIds")));
        postJson("/api/tenant/notifications", ADMIN_A, "{\"subject\":\"s\",\"body\":\"b\",\"userIds\":[]}")
                .andExpect(status().isBadRequest());
        postJson("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT, "{\"subject\":\"s\",\"body\":\"b\",\"audience\":\"SELECTED\",\"userIds\":[]}")
                .andExpect(status().isBadRequest());
        assertEquals(0, mongo.getCollection("notifications").countDocuments());

        // A broadcast of tenant A stays in tenant A, whoever sends it.
        member(tenantB, "bea");
        sendAsTenantAdmin(ADMIN_A, broadcast("A only"));
        sendAsSuperAdmin(tenantA, broadcast("A only, from the platform"));
        mvc.perform(get("/api/notifications").with(as("bea"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications/unread-count").with(as("bea"))).andExpect(jsonPath("$.unreadCount").value(0));

        // Removing the last recipient is refused: the list never becomes empty.
        String id = sendAsTenantAdmin(ADMIN_A, selected("Just Uma", uma));
        patchJson("/api/tenant/notifications/" + id, ADMIN_A, "{\"removeUserIds\":[\"" + uma + "\"]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("at least one recipient")));
        assertEquals(1, raw(id).getList("users", Document.class).size());
    }

    // ==================== 5. recipients must belong to the target tenant ====================

    @Test
    void recipientsFromAnotherTenantAreRejectedLikeUnknownIds() throws Exception {
        String uma = member(tenantA, "uma");
        String bea = member(tenantB, "bea");
        String suspended = member(tenantA, "sam", UserRole.USER, UserStatus.SUSPENDED);

        String crossTenant = postJson("/api/tenant/notifications", ADMIN_A, selected("x", uma, bea))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        String unknown = postJson("/api/tenant/notifications", ADMIN_A, selected("x", uma, "000000000000000000000001"))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();
        // The same wording either way: the answer does not say the id exists elsewhere.
        assertEquals(json(crossTenant, "$.message").replace(bea, "ID"), json(unknown, "$.message").replace("000000000000000000000001", "ID"));

        postJson("/api/tenant/notifications", ADMIN_A, selected("x", suspended)).andExpect(status().isBadRequest());
        postJson("/api/super-admin/tenants/" + tenantA + "/notifications", ROOT, selected("x", bea)).andExpect(status().isBadRequest());
        // The whole request is refused: nothing was saved for the valid recipient either.
        assertEquals(0, mongo.getCollection("notifications").countDocuments());

        // An INVITED member can be selected (they see it once active).
        String invited = member(tenantA, "ivy", UserRole.USER, UserStatus.INVITED);
        sendAsTenantAdmin(ADMIN_A, selected("Welcome", invited));
    }

    // ==================== 6. who may manage ====================

    @Test
    void onlyAdministratorsWithThePermissionManageNotifications() throws Exception {
        String uma = member(tenantA, "uma");
        String id = sendAsTenantAdmin(ADMIN_A, selected("Hello", uma));

        // A regular user: no management endpoint at all.
        postJson("/api/tenant/notifications", "uma", broadcast("x")).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/notifications").with(as("uma"))).andExpect(status().isForbidden());
        mvc.perform(get("/api/tenant/notifications/" + id).with(as("uma"))).andExpect(status().isForbidden());
        patchJson("/api/tenant/notifications/" + id, "uma", "{\"subject\":\"Hacked\"}").andExpect(status().isForbidden());
        patchJson("/api/tenant/notifications/" + id + "/status", "uma", "{\"status\":\"ARCHIVED\"}").andExpect(status().isForbidden());
        postJson("/api/super-admin/tenants/" + tenantA + "/notifications", "uma", broadcast("x")).andExpect(status().isForbidden());
        assertEquals("Hello", raw(id).getString("subject"));

        // Managing notifications follows the ADMIN role: a general permission list left in an old
        // document neither removes it from an administrator nor gives it to a user.
        String admin2 = member(tenantA, "second-admin", UserRole.ADMIN, UserStatus.ACTIVE);
        mongo.updateFirst(new Query(Criteria.where("id").is(admin2)), new Update().set("permissions", List.of("USERS_VIEW")), user.class);
        postJson("/api/tenant/notifications", "second-admin", broadcast("x")).andExpect(status().isCreated());
        mvc.perform(get("/api/tenant/notifications").with(as("second-admin"))).andExpect(status().isOk());
        mvc.perform(get("/api/notifications").with(as("second-admin"))).andExpect(status().isOk());
        mongo.updateFirst(new Query(Criteria.where("cognitoSub").is("uma")),
                new Update().set("permissions", List.of("NOTIFICATIONS_MANAGE")), user.class);
        postJson("/api/tenant/notifications", "uma", broadcast("x")).andExpect(status().isForbidden());
        // An inactive administrator manages nothing.
        String gone = member(tenantA, "gone-admin", UserRole.ADMIN, UserStatus.SUSPENDED);
        assertTrue(gone != null);
        mvc.perform(get("/api/tenant/notifications").with(as("gone-admin"))).andExpect(status().isForbidden());

        // A Super Admin has no inbox (no tenant), and a Tenant Admin no Super Admin route.
        mvc.perform(get("/api/notifications").with(as(ROOT))).andExpect(status().isForbidden());
        mvc.perform(get("/api/super-admin/tenants/" + tenantA + "/notifications").with(as(ADMIN_A))).andExpect(status().isForbidden());

        // A platform notification is readable by the Tenant Admin but changed only by a Super Admin.
        String fromPlatform = sendAsSuperAdmin(tenantA, broadcast("From the platform"));
        mvc.perform(get("/api/tenant/notifications/" + fromPlatform).with(as(ADMIN_A))).andExpect(status().isOk());
        patchJson("/api/tenant/notifications/" + fromPlatform, ADMIN_A, "{\"subject\":\"Changed\"}").andExpect(status().isForbidden());
        patchJson("/api/tenant/notifications/" + fromPlatform + "/status", ADMIN_A, "{\"status\":\"ARCHIVED\"}").andExpect(status().isForbidden());
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + fromPlatform, ROOT, "{\"subject\":\"Changed\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subject").value("Changed"));
        // And the Super Admin may change a Tenant Admin's notification too.
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + id, ROOT, "{\"body\":\"Corrected\"}").andExpect(status().isOk());

        // Another tenant's admin does not find it at all.
        mvc.perform(get("/api/tenant/notifications/" + id).with(as(ADMIN_B))).andExpect(status().isNotFound());
        patchJson("/api/tenant/notifications/" + id, ADMIN_B, "{\"subject\":\"x\"}").andExpect(status().isNotFound());
    }

    // ==================== 7. own entry only ====================

    @Test
    void aMemberChangesOnlyTheirOwnReadState() throws Exception {
        String uma = member(tenantA, "uma");
        String luis = member(tenantA, "luis");
        member(tenantA, "carla");
        String id = sendAsTenantAdmin(ADMIN_A, selected("Read me", uma, luis));

        mvc.perform(get("/api/notifications/" + id).with(as("uma"))).andExpect(jsonPath("$.readStatus").value(false));
        // Viewing did not mark it read.
        assertEquals(Boolean.FALSE, recipient(id, uma).get("readStatus"));

        markRead("uma", id, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.readStatus").value(true))
                .andExpect(jsonPath("$.readAt").isNotEmpty())
                .andExpect(jsonPath("$.users").doesNotExist());
        assertEquals(Boolean.TRUE, recipient(id, uma).get("readStatus"));
        assertNotNull(recipient(id, uma).get("readAt"));
        assertEquals(Boolean.FALSE, recipient(id, luis).get("readStatus"));
        assertNull(recipient(id, luis).get("readAt"));

        mvc.perform(get("/api/notifications/unread-count").with(as("uma"))).andExpect(jsonPath("$.unreadCount").value(0));
        mvc.perform(get("/api/notifications/unread-count").with(as("luis"))).andExpect(jsonPath("$.unreadCount").value(1));

        // Not a recipient: nothing to mark, and nothing changes. A body naming another user is ignored.
        markRead("carla", id, true).andExpect(status().isNotFound());
        patchJson("/api/notifications/" + id + "/read-status", "luis", "{\"read\":true,\"userId\":\"" + uma + "\"}")
                .andExpect(status().isOk());
        assertEquals(Boolean.TRUE, recipient(id, luis).get("readStatus"));
        markRead("luis", id, false).andExpect(jsonPath("$.readStatus").value(false));
        assertEquals(Boolean.TRUE, recipient(id, uma).get("readStatus"));

        // Filters follow the caller's own state.
        mvc.perform(get("/api/notifications?filter=READ").with(as("uma"))).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/notifications?filter=UNREAD").with(as("uma"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications?filter=UNREAD").with(as("luis"))).andExpect(jsonPath("$.totalElements").value(1));

        // The admin view shows each recipient's state.
        mvc.perform(get("/api/tenant/notifications/" + id).with(as(ADMIN_A)))
                .andExpect(jsonPath("$.readCount").value(1))
                .andExpect(jsonPath("$.users[?(@.userId=='" + uma + "')].readStatus").value(true))
                .andExpect(jsonPath("$.users[?(@.userId=='" + luis + "')].readStatus").value(false));
        markRead("uma", id, true).andExpect(status().isOk());
        mvc.perform(get("/api/tenant/notifications").with(as(ADMIN_A)))
                .andExpect(jsonPath("$.content[0].recipientCount").value(2))
                .andExpect(jsonPath("$.content[0].readCount").value(1))
                .andExpect(jsonPath("$.content[0].users").doesNotExist());
    }

    // ==================== 8. broadcast read state per member ====================

    @Test
    void broadcastReadStateIsIndependentForEveryMember() throws Exception {
        member(tenantA, "ana");
        member(tenantA, "ben");
        String id = sendAsTenantAdmin(ADMIN_A, broadcast("All hands"));

        markRead("ana", id, true).andExpect(jsonPath("$.readStatus").value(true));
        mvc.perform(get("/api/notifications/" + id).with(as("ben"))).andExpect(jsonPath("$.readStatus").value(false));
        mvc.perform(get("/api/notifications/unread-count").with(as("ben"))).andExpect(jsonPath("$.unreadCount").value(1));
        mvc.perform(get("/api/notifications/unread-count").with(as("ana"))).andExpect(jsonPath("$.unreadCount").value(0));
        assertTrue(raw(id).getList("users", Document.class).isEmpty(), "broadcast reads never go into users");
        assertEquals(1, mongo.count(new Query(), NotificationReceipt.class));
        NotificationReceipt receipt = mongo.findOne(new Query(), NotificationReceipt.class);
        assertEquals(id, receipt.getNotificationId());
        assertEquals(tenantA, receipt.getTenantId());
        assertEquals(userIdOf("ana"), receipt.getUserId());
        assertNotNull(receipt.getReadAt());

        mvc.perform(get("/api/tenant/notifications/" + id).with(as(ADMIN_A))).andExpect(jsonPath("$.readCount").value(1));
        mvc.perform(get("/api/notifications?filter=READ").with(as("ana"))).andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/notifications?filter=UNREAD").with(as("ana"))).andExpect(jsonPath("$.totalElements").value(0));

        markRead("ben", id, true);
        markRead("ana", id, false).andExpect(jsonPath("$.readStatus").value(false)).andExpect(jsonPath("$.readAt").value(nullValue()));
        mvc.perform(get("/api/notifications/" + id).with(as("ben"))).andExpect(jsonPath("$.readStatus").value(true));
        assertEquals(1, mongo.count(new Query(), NotificationReceipt.class));
        mvc.perform(get("/api/tenant/notifications").with(as(ADMIN_A))).andExpect(jsonPath("$.content[0].readCount").value(1));
    }

    // ==================== 9. idempotent read / unread ====================

    @Test
    void repeatedReadAndUnreadRequestsChangeNothing() throws Exception {
        String uma = member(tenantA, "uma");
        member(tenantA, "ana");
        String selectedId = sendAsTenantAdmin(ADMIN_A, selected("Once", uma));
        String broadcastId = sendAsTenantAdmin(ADMIN_A, broadcast("Once for all"));

        markRead("uma", selectedId, true).andExpect(status().isOk());
        Object firstReadAt = recipient(selectedId, uma).get("readAt");
        Thread.sleep(5);
        markRead("uma", selectedId, true).andExpect(status().isOk()).andExpect(jsonPath("$.readStatus").value(true));
        assertEquals(firstReadAt, recipient(selectedId, uma).get("readAt"), "a second read keeps the first readAt");
        markRead("uma", selectedId, false).andExpect(status().isOk());
        markRead("uma", selectedId, false).andExpect(status().isOk()).andExpect(jsonPath("$.readStatus").value(false));

        markRead("ana", broadcastId, true).andExpect(status().isOk());
        NotificationReceipt first = mongo.findOne(new Query(), NotificationReceipt.class);
        markRead("ana", broadcastId, true).andExpect(status().isOk());
        assertEquals(1, mongo.count(new Query(), NotificationReceipt.class));
        assertEquals(first.getReadAt(), mongo.findOne(new Query(), NotificationReceipt.class).getReadAt());
        markRead("ana", broadcastId, false).andExpect(status().isOk());
        markRead("ana", broadcastId, false).andExpect(status().isOk()).andExpect(jsonPath("$.readStatus").value(false));
        assertEquals(0, mongo.count(new Query(), NotificationReceipt.class));

        patchJson("/api/notifications/" + broadcastId + "/read-status", "ana", "{}").andExpect(status().isBadRequest());
    }

    // ==================== 10. later members do not inherit older broadcasts ====================

    @Test
    void membersWhoJoinLaterDoNotSeeOlderBroadcasts() throws Exception {
        String older = sendAsTenantAdmin(ADMIN_A, broadcast("Before you joined"));
        Thread.sleep(20);
        member(tenantA, "newcomer");

        mvc.perform(get("/api/notifications").with(as("newcomer"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications/unread-count").with(as("newcomer"))).andExpect(jsonPath("$.unreadCount").value(0));
        mvc.perform(get("/api/notifications/" + older).with(as("newcomer"))).andExpect(status().isNotFound());
        markRead("newcomer", older, true).andExpect(status().isNotFound());
        // The owner, who was there before, still sees it.
        mvc.perform(get("/api/notifications/" + older).with(as(ADMIN_A))).andExpect(status().isOk());

        String newer = sendAsTenantAdmin(ADMIN_A, broadcast("After you joined"));
        mvc.perform(get("/api/notifications").with(as("newcomer")))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(newer));
        // Selected notifications are addressed by id, so a newcomer can be chosen explicitly at any time.
        String direct = sendAsTenantAdmin(ADMIN_A, selected("For you", userIdOf("newcomer")));
        mvc.perform(get("/api/notifications").with(as("newcomer")))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].id").value(direct));
    }

    // ==================== 11. archive ====================

    @Test
    void archivedNotificationsLeaveInboxesAndCountsButStayForAdministrators() throws Exception {
        String uma = member(tenantA, "uma");
        String note = sendAsTenantAdmin(ADMIN_A, selected("Soon archived", uma));
        String all = sendAsTenantAdmin(ADMIN_A, broadcast("Broadcast soon archived"));
        mvc.perform(get("/api/notifications/unread-count").with(as("uma"))).andExpect(jsonPath("$.unreadCount").value(2));

        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, "{\"status\":\"ARCHIVED\",\"reason\":\"Superseded\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"))
                .andExpect(jsonPath("$.archivedAt").isNotEmpty());
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + all + "/status", ROOT, "{\"status\":\"ARCHIVED\"}")
                .andExpect(status().isOk());

        mvc.perform(get("/api/notifications").with(as("uma"))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/notifications/unread-count").with(as("uma"))).andExpect(jsonPath("$.unreadCount").value(0));
        mvc.perform(get("/api/notifications/" + note).with(as("uma"))).andExpect(status().isNotFound());
        markRead("uma", note, true).andExpect(status().isNotFound());

        // Still there for administrators, and not deleted.
        assertEquals(2, mongo.getCollection("notifications").countDocuments());
        mvc.perform(get("/api/tenant/notifications?status=ARCHIVED").with(as(ADMIN_A))).andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/tenant/notifications?status=ACTIVE").with(as(ADMIN_A))).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/tenant/notifications").with(as(ADMIN_A))).andExpect(jsonPath("$.totalElements").value(2));

        // Never deleted, not edited while archived; archiving again changes nothing. (Restoring is
        // NotificationRestoreIntegrationTest.)
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, "{\"status\":\"DELETED\"}").andExpect(status().isBadRequest());
        patchJson("/api/tenant/notifications/" + note, ADMIN_A, "{\"subject\":\"Edited\"}").andExpect(status().isConflict());
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, "{\"status\":\"ARCHIVED\"}").andExpect(status().isOk());
        assertEquals(2, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_ARCHIVED)), AuditEvent.class));
        AuditEvent archived = mongo.findOne(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_ARCHIVED)
                .and("targetId").is(note)), AuditEvent.class);
        assertEquals("Superseded", archived.getDetails().get("reason"));
    }

    // ==================== update keeps read states ====================

    @Test
    void editingRecipientsKeepsEveryoneElsesReadState() throws Exception {
        String uma = member(tenantA, "uma");
        String luis = member(tenantA, "luis");
        String carla = member(tenantA, "carla");
        String bea = member(tenantB, "bea");
        String id = sendAsTenantAdmin(ADMIN_A, selected("Team note", uma, luis));
        markRead("uma", id, true);

        patchJson("/api/tenant/notifications/" + id, ADMIN_A,
                "{\"subject\":\"$100 bonus\",\"addUserIds\":[\"" + carla + "\",\"" + uma + "\"],\"removeUserIds\":[\"" + luis + "\"]}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.subject").value("$100 bonus"))
                .andExpect(jsonPath("$.users[*].userId", containsInAnyOrder(uma, carla)))
                .andExpect(jsonPath("$.users[?(@.userId=='" + uma + "')].readStatus").value(true))
                .andExpect(jsonPath("$.users[?(@.userId=='" + carla + "')].readStatus").value(false))
                .andExpect(jsonPath("$.updatedBy").value(userIdOf(ADMIN_A)));
        assertEquals(Set.of("userId", "readStatus", "readAt"), recipient(id, carla).keySet());
        mvc.perform(get("/api/notifications/" + id).with(as("luis"))).andExpect(status().isNotFound());

        patchJson("/api/tenant/notifications/" + id, ADMIN_A, "{\"addUserIds\":[\"" + bea + "\"]}").andExpect(status().isBadRequest());
        patchJson("/api/tenant/notifications/" + id, ADMIN_A, "{\"removeUserIds\":[\"" + luis + "\"]}").andExpect(status().isBadRequest());
        patchJson("/api/tenant/notifications/" + id, ADMIN_A, "{}").andExpect(status().isBadRequest());
        patchJson("/api/tenant/notifications/" + id, ADMIN_A, "{\"subject\":\"   \"}").andExpect(status().isBadRequest());
        String all = sendAsTenantAdmin(ADMIN_A, broadcast("Everyone"));
        patchJson("/api/tenant/notifications/" + all, ADMIN_A, "{\"addUserIds\":[\"" + uma + "\"]}").andExpect(status().isBadRequest());
        assertEquals(2, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_CREATED)), AuditEvent.class));
        assertEquals(1, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_UPDATED)), AuditEvent.class));
    }

    // ==================== 13. concurrency ====================

    @Test
    void concurrentReadsAndAnEditDoNotOverwriteEachOther() throws Exception {
        List<String> subs = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            subs.add("reader-" + i);
            ids.add(member(tenantA, "reader-" + i));
        }
        String extra = member(tenantA, "late-addition");
        String id = sendAsTenantAdmin(ADMIN_A, selected("Concurrent", ids.toArray(String[]::new)));
        String all = sendAsTenantAdmin(ADMIN_A, broadcast("Concurrent broadcast"));

        List<Callable<Object>> work = new ArrayList<>();
        for (String sub : subs) {
            work.add(() -> inboxService.setReadStatus(token(sub), id, true));
            work.add(() -> inboxService.setReadStatus(token(sub), all, true));
            work.add(() -> inboxService.setReadStatus(token(sub), all, true));
        }
        work.add(() -> notificationService.update(notificationService.tenantScope(token(ADMIN_A)), id,
                new UpdateNotificationRequest("Concurrent, edited", null, List.of(extra), null)));
        runTogether(work);

        Document doc = raw(id);
        assertEquals("Concurrent, edited", doc.getString("subject"));
        List<Document> users = doc.getList("users", Document.class);
        assertEquals(21, users.size());
        for (Document recipient : users) {
            boolean added = extra.equals(recipient.getString("userId"));
            assertEquals(!added, recipient.getBoolean("readStatus"), "read state of " + recipient.getString("userId"));
            assertEquals(!added, recipient.get("readAt") != null);
        }
        // One receipt per member, however many times each asked.
        assertEquals(20, mongo.count(new Query(Criteria.where("notificationId").is(all)), NotificationReceipt.class));
        mvc.perform(get("/api/tenant/notifications/" + all).with(as(ADMIN_A))).andExpect(jsonPath("$.readCount").value(20));
    }

    // ==================== helpers ====================

    private Document recipient(String notificationId, String userId) {
        return raw(notificationId).getList("users", Document.class).stream()
                .filter(r -> userId.equals(r.getString("userId"))).findFirst().orElseThrow();
    }

    private static void runTogether(List<Callable<Object>> work) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(12);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Object>> futures = new ArrayList<>();
            for (Callable<Object> task : work) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            for (Future<Object> future : futures) {
                future.get(60, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
    }

}
