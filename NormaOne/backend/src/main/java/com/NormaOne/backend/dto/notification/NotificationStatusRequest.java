package com.NormaOne.backend.dto.notification;

import com.NormaOne.backend.model.core.enums.RecordState;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Archive a notification: {@code status} must be ARCHIVED. An archived notification is not
 * reactivated and is never deleted by this endpoint. The reason, if any, goes to the audit trail.
 */
public record NotificationStatusRequest(
        @NotNull(message = "Status is required: ARCHIVED")
        RecordState status,

        @Size(max = 500, message = "Reason must not exceed 500 characters")
        String reason
) {}
