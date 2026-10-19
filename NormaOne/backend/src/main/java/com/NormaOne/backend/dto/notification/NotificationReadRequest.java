package com.NormaOne.backend.dto.notification;

import jakarta.validation.constraints.NotNull;

/**
 * Mark the caller's own copy read (true) or unread (false). There is no user field: it is always
 * the signed-in member, and the server records the time.
 */
public record NotificationReadRequest(
        @NotNull(message = "read is required: true or false")
        Boolean read
) {}
