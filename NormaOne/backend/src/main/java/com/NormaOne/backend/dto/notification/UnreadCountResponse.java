package com.NormaOne.backend.dto.notification;

/** How many of the caller's visible, ACTIVE notifications the caller has not read. */
public record UnreadCountResponse(long unreadCount) {}
