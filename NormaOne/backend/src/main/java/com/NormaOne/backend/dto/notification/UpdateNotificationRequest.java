package com.NormaOne.backend.dto.notification;

import java.util.List;

import com.NormaOne.backend.model.notification.Notification;

import jakarta.validation.constraints.Size;

/**
 * Changes to an ACTIVE notification; only the fields sent are changed. {@code addUserIds} and
 * {@code removeUserIds} apply to SELECTED notifications only: added recipients start unread, the
 * others keep their read state, and the last recipient cannot be removed (archive instead). The
 * audience and the tenant never change.
 */
public record UpdateNotificationRequest(
        @Size(max = Notification.SUBJECT_MAX, message = "Subject must not exceed 200 characters")
        String subject,

        @Size(max = Notification.BODY_MAX, message = "Body must not exceed 10000 characters")
        String body,

        List<@Size(min = 1, max = 64, message = "A user id must be 1 to 64 characters") String> addUserIds,

        List<@Size(min = 1, max = 64, message = "A user id must be 1 to 64 characters") String> removeUserIds
) {}
