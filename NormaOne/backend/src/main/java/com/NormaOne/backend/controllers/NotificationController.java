package com.NormaOne.backend.controllers;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.notification.NotificationInboxItem;
import com.NormaOne.backend.dto.notification.NotificationReadFilter;
import com.NormaOne.backend.dto.notification.NotificationReadRequest;
import com.NormaOne.backend.dto.notification.UnreadCountResponse;
import com.NormaOne.backend.services.NotificationInboxService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * The signed-in member's own notifications (ADMIN or USER). Nothing here takes a user or tenant
 * id: both come from the caller's stored record, and read state is only ever the caller's own.
 */
@RestController
@RequestMapping("/api/notifications")
@PreAuthorize("hasAnyRole('ADMIN', 'USER')")
public class NotificationController {

    private final NotificationInboxService inboxService;

    public NotificationController(NotificationInboxService inboxService) {
        this.inboxService = inboxService;
    }

    @GetMapping
    public ResponseEntity<PageResponse<NotificationInboxItem>> inbox(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "ALL") NotificationReadFilter filter,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(inboxService.list(jwt, filter, page, size));
    }

    @GetMapping("/unread-count")
    public ResponseEntity<UnreadCountResponse> unreadCount(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(inboxService.unreadCount(jwt));
    }

    /** Does not mark the notification read. */
    @GetMapping("/{id}")
    public ResponseEntity<NotificationInboxItem> get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return ResponseEntity.ok(inboxService.get(jwt, id));
    }

    @PatchMapping("/{id}/read-status")
    public ResponseEntity<NotificationInboxItem> readStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String id,
            @Valid @RequestBody NotificationReadRequest request) {
        return ResponseEntity.ok(inboxService.setReadStatus(jwt, id, request.read()));
    }

    @GetMapping("/{id}/attachment")
    public ResponseEntity<?> attachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return inboxService.downloadAttachment(jwt, id);
    }
}
