package com.NormaOne.backend.model.notification;

import java.time.Instant;

import org.springframework.data.mongodb.core.mapping.Field;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One recipient of a SELECTED notification and that recipient's own read state,
 * embedded in Notification.users.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NotificationRecipient {

    /** ID of the recipient's user document in the same tenant. */
    @NotBlank
    private String userId;

    @NotNull
    private Boolean readStatus;

    /** When the recipient read it; stored as null until then. */
    @Field(write = Field.Write.ALWAYS)
    private Instant readAt;
}