package com.NormaOne.backend.dto.notification;

import com.NormaOne.backend.model.core.enums.RecordState;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Archive or restore a notification: {@code status} ARCHIVED archives it (hidden from every member,
 * not editable); ACTIVE restores an archived one, unchanged. Nothing is ever deleted by this endpoint.
 * The reason, if any, goes to the audit trail.
 */
public record NotificationStatusRequest(
        @NotNull(message = "Status is required: ARCHIVED (archive) or ACTIVE (restore)")
        RecordState status,
        @Size(max = 500, message = "Reason must not exceed 500 characters")
        String reason
) {}
