package com.NormaOne.backend.dto.notification;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One recipient of a SELECTED notification, for administrators: the stored
 * {@code {userId, readStatus, readAt}} plus the member's name and email for display.
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RecipientResponse(
        String userId,
        boolean readStatus,
        Instant readAt,
        String name,
        String email
) {}
