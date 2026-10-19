package com.NormaOne.backend.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.audit.AuditEvent;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;

/**
 * Restoring an archived notification (PATCH …/status with ACTIVE): the same people who may archive it
 * may restore it, in their own tenant only; it comes back exactly as it was — content, audience,
 * recipients, read states — visible again to its recipients, with the audit trail extended.
 */
class NotificationRestoreIntegrationTest extends NotificationTestBase {

    private static final String RESTORE = "{\"status\":\"ACTIVE\",\"reason\":\"Archived by mistake\"}";
    private static final String ARCHIVE = "{\"status\":\"ARCHIVED\",\"reason\":\"Old\"}";

    private String stateOf(String noteId) {
        return raw(noteId).getString("recordState");
    }

    @Test
    void anArchivedNotificationIsRestoredExactlyAsItWas() throws Exception {
        String uma = member(tenantA, "uma");
        String ugo = member(tenantA, "ugo");
        String note = sendAsTenantAdmin(ADMIN_A, selected("Policy", uma, ugo));
        markRead("uma", note, true).andExpect(status().isOk());
        Document before = raw(note);

        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, ARCHIVE)
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ARCHIVED"));
        mvc.perform(get("/api/notifications/" + note).with(as("uma"))).andExpect(status().isNotFound());
        mvc.perform(get("/api/notifications/unread-count").with(as("ugo"))).andExpect(jsonPath("$.unreadCount").value(0));

        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, RESTORE)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.archivedAt").doesNotExist())
                .andExpect(jsonPath("$.subject").value("Policy"))
                .andExpect(jsonPath("$.audience").value("SELECTED"))
                .andExpect(jsonPath("$.recipientCount").value(2));

        // Content, audience, recipients and each recipient's read state are unchanged.
        Document after = raw(note);
        assertEquals("ACTIVE", after.getString("recordState"));
        assertNull(after.get("archivedAt"));
        assertEquals(before.getString("subject"), after.getString("subject"));
        assertEquals(before.getString("body"), after.getString("body"));
        assertEquals(before.getString("audience"), after.getString("audience"));
        assertEquals(before.getList("users", Document.class).stream().map(u -> u.getString("userId") + ":" + u.getBoolean("readStatus")).toList(),
                after.getList("users", Document.class).stream().map(u -> u.getString("userId") + ":" + u.getBoolean("readStatus")).toList());

        // Visible again, with the read states they had.
        mvc.perform(get("/api/notifications/" + note).with(as("uma"))).andExpect(status().isOk()).andExpect(jsonPath("$.readStatus").value(true));
        mvc.perform(get("/api/notifications/unread-count").with(as("ugo"))).andExpect(jsonPath("$.unreadCount").value(1));
        mvc.perform(get("/api/tenant/notifications?status=ACTIVE").with(as(ADMIN_A))).andExpect(jsonPath("$.totalElements").value(1));
        // Editable again.
        patchJson("/api/tenant/notifications/" + note, ADMIN_A, "{\"subject\":\"Policy v2\"}").andExpect(status().isOk());

        // The audit trail keeps both steps.
        assertEquals(1, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_ARCHIVED).and("targetId").is(note)), AuditEvent.class));
        AuditEvent restored = mongo.findOne(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_RESTORED).and("targetId").is(note)), AuditEvent.class);
        assertEquals("Archived by mistake", restored.getDetails().get("reason"));
        assertEquals(tenantA, restored.getTenantId());

        // Restoring an ACTIVE notification changes nothing and records nothing.
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, RESTORE).andExpect(status().isOk());
        assertEquals(1, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_RESTORED)), AuditEvent.class));
    }

    @Test
    void aRestoredBroadcastReachesTheMembersItReachedBefore() throws Exception {
        String uma = member(tenantA, "uma");
        String note = sendAsTenantAdmin(ADMIN_A, broadcast("Holiday"));
        markRead("uma", note, true).andExpect(status().isOk());
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, ARCHIVE).andExpect(status().isOk());
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, RESTORE).andExpect(status().isOk());
        // The member's own receipt (read) survived archive and restore.
        mvc.perform(get("/api/notifications/" + note).with(as("uma"))).andExpect(status().isOk()).andExpect(jsonPath("$.readStatus").value(true));
        assertTrue(uma != null);
    }

    @Test
    void onlyThoseWhoMayArchiveMayRestoreInTheirOwnTenant() throws Exception {
        String uma = member(tenantA, "uma");
        member(tenantA, "ivo", UserRole.ADMIN, UserStatus.ACTIVE);
        String byAdmin = sendAsTenantAdmin(ADMIN_A, selected("By admin", uma));
        String byPlatform = sendAsSuperAdmin(tenantA, selected("By platform", uma));
        for (String note : List.of(byAdmin, byPlatform)) {
            patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + note + "/status", ROOT, ARCHIVE).andExpect(status().isOk());
        }

        // A member (USER) has no administration route.
        patchJson("/api/tenant/notifications/" + byAdmin + "/status", "uma", RESTORE).andExpect(status().isForbidden());
        // Another tenant's administrator does not find it, in either route.
        patchJson("/api/tenant/notifications/" + byAdmin + "/status", ADMIN_B, RESTORE).andExpect(status().isNotFound());
        patchJson("/api/super-admin/tenants/" + tenantB + "/notifications/" + byAdmin + "/status", ROOT, RESTORE).andExpect(status().isNotFound());
        // A Tenant Admin cannot restore what the platform sent (as for archiving).
        patchJson("/api/tenant/notifications/" + byPlatform + "/status", ADMIN_A, RESTORE).andExpect(status().isForbidden());
        // A Super Admin is not a Tenant Admin.
        patchJson("/api/tenant/notifications/" + byAdmin + "/status", ROOT, RESTORE).andExpect(status().isForbidden());
        assertEquals("ARCHIVED", stateOf(byAdmin));
        assertEquals("ARCHIVED", stateOf(byPlatform));
        assertEquals(0, mongo.count(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_RESTORED)), AuditEvent.class));

        // Any administrator of the tenant may restore an admin's notification; the Super Admin restores anything there.
        patchJson("/api/tenant/notifications/" + byAdmin + "/status", "ivo", RESTORE).andExpect(status().isOk());
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + byPlatform + "/status", ROOT, RESTORE).andExpect(status().isOk());
        assertEquals("ACTIVE", stateOf(byAdmin));
        assertEquals("ACTIVE", stateOf(byPlatform));
    }

    @Test
    void aSuspendedOrganizationsNotificationsAreNotRestoredAndOnlyArchiveOrRestoreAreAccepted() throws Exception {
        String uma = member(tenantA, "uma");
        String note = sendAsTenantAdmin(ADMIN_A, selected("Note", uma));
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, ARCHIVE).andExpect(status().isOk());
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, "{\"status\":\"DELETED\"}").andExpect(status().isBadRequest());
        patchJson("/api/tenant/notifications/" + note + "/status", ADMIN_A, "{}").andExpect(status().isBadRequest());
        patchJson("/api/super-admin/tenants/" + tenantA + "/status", ROOT, "{\"status\":\"SUSPENDED\",\"reason\":\"Review\"}").andExpect(status().isOk());
        patchJson("/api/super-admin/tenants/" + tenantA + "/notifications/" + note + "/status", ROOT, RESTORE).andExpect(status().isConflict());
        assertEquals("ARCHIVED", stateOf(note));
        assertFalse(mongo.exists(new Query(Criteria.where("action").is(AuditAction.NOTIFICATION_RESTORED)), AuditEvent.class));
    }
}
