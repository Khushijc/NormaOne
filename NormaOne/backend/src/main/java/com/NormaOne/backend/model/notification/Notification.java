package com.NormaOne.backend.model.notification;

import java.util.ArrayList;
import java.util.List;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * A message from a Tenant Admin or a Super Admin to members of one tenant.
 *
 * Inherited: id, tenantId, recordState (ACTIVE / ARCHIVED; the API calls it "status"), archivedAt,
 * createdAt, updatedAt, createdByDocsId (the creator's user id), updatedByDocsId and version.
 *
 * Audience:
 * <ul>
 *   <li>SELECTED: {@code users} lists the recipients, each with their own read state. Never empty.</li>
 *   <li>TENANT: {@code users} is empty and the notification is for every eligible member of
 *       {@code tenantId} who joined on or before {@code createdAt} — never for the whole platform.
 *       Each member's read state is a NotificationReceipt, so one read never marks it for others.</li>
 * </ul>
 * The audience is stored explicitly, so an emptied list can never turn into a broadcast.
 *
 * Indexes are created by MongoIndexInitializer (automatic index creation is off); the annotations
 * repeat the same names and definitions.
 */
@Document(collection = "notifications")
@CompoundIndexes({
        @CompoundIndex(name = "notification_tenant_audience_time_idx",
                def = "{'tenantId': 1, 'recordState': 1, 'audience': 1, 'createdAt': -1}"),
        @CompoundIndex(name = "notification_recipient_time_idx",
                def = "{'tenantId': 1, 'users.userId': 1, 'recordState': 1, 'createdAt': -1}"),
        @CompoundIndex(name = "notification_creator_time_idx",
                def = "{'tenantId': 1, 'createdByDocsId': 1, 'createdAt': -1}")
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class Notification extends TenantBase {

    public static final int SUBJECT_MAX = 200;
    public static final int BODY_MAX = 10_000;

    @NotBlank
    @Size(max = SUBJECT_MAX)
    private String subject;

    /** Plain text. Clients must render it as text, never as HTML. */
    @NotBlank
    @Size(max = BODY_MAX)
    private String body;

    @NotNull
    private NotificationAudience audience;

    /** SELECTED: the recipients and their read state. TENANT: always empty. */
    @Builder.Default
    private List<NotificationRecipient> users = new ArrayList<>();

    /** Optional; stored as an explicit null when there is none. */
    @Field(write = Field.Write.ALWAYS)
    private NotificationAttachment attachment;

    /**
     * ADMIN or SUPER_ADMIN at creation. A Tenant Admin may edit or archive only notifications an
     * ADMIN created; a Super Admin's notification is changed only by a Super Admin.
     */
    @NotNull
    private UserRole createdByRole;
}
