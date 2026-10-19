package com.NormaOne.backend.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.notification.CreateNotificationRequest;
import com.NormaOne.backend.dto.notification.NotificationResponse;
import com.NormaOne.backend.dto.notification.NotificationStatusRequest;
import com.NormaOne.backend.dto.notification.RecipientOptionResponse;
import com.NormaOne.backend.dto.notification.UpdateNotificationRequest;
import com.NormaOne.backend.model.core.enums.RecordState;
import com.NormaOne.backend.model.notification.enums.NotificationAudience;
import com.NormaOne.backend.services.NotificationService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * A Super Admin's notifications to one tenant, named in the path (it must exist; sending needs it
 * ACTIVE). There is no platform-wide notification: every one of these belongs to that tenant.
 */
@RestController
@RequestMapping("/api/super-admin/tenants/{tenantId}/notifications")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class SuperAdminNotificationController {

    private final NotificationService notificationService;

    public SuperAdminNotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<NotificationResponse> create(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @Valid @RequestBody CreateNotificationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(notificationService.create(notificationService.platformScope(jwt, tenantId), request, null));
    }

    /** The same, with an attachment: a "notification" JSON part and an optional "attachment" file part. */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<NotificationResponse> createWithAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @Valid @RequestPart("notification") CreateNotificationRequest request,
            @RequestPart(value = "attachment", required = false) MultipartFile attachment) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(notificationService.create(notificationService.platformScope(jwt, tenantId), request, attachment));
    }

    @GetMapping
    public ResponseEntity<PageResponse<NotificationResponse>> list(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @RequestParam(required = false) RecordState status,
            @RequestParam(required = false) NotificationAudience audience,
            @RequestParam(required = false) @Size(max = 64) String createdBy,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(notificationService.list(notificationService.platformScope(jwt, tenantId),
                status, audience, createdBy, page, size));
    }

    /** Members of the tenant in the path who can be chosen as recipients (INVITED or ACTIVE). */
    @GetMapping("/recipients")
    public ResponseEntity<PageResponse<RecipientOptionResponse>> recipients(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(notificationService.recipients(notificationService.platformScope(jwt, tenantId), search, page, size));
    }

    @GetMapping("/{id}")
    public ResponseEntity<NotificationResponse> get(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return ResponseEntity.ok(notificationService.get(notificationService.platformScope(jwt, tenantId), id));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<NotificationResponse> update(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @PathVariable @Size(min = 1, max = 64) String id,
            @Valid @RequestBody UpdateNotificationRequest request) {
        return ResponseEntity.ok(notificationService.update(notificationService.platformScope(jwt, tenantId), id, request));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<NotificationResponse> changeStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @PathVariable @Size(min = 1, max = 64) String id,
            @Valid @RequestBody NotificationStatusRequest request) {
        return ResponseEntity.ok(notificationService.changeStatus(notificationService.platformScope(jwt, tenantId), id, request));
    }

    @PutMapping(value = "/{id}/attachment", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<NotificationResponse> replaceAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @PathVariable @Size(min = 1, max = 64) String id,
            @RequestPart("attachment") MultipartFile attachment) {
        return ResponseEntity.ok(notificationService.replaceAttachment(notificationService.platformScope(jwt, tenantId), id, attachment));
    }

    @DeleteMapping("/{id}/attachment")
    public ResponseEntity<NotificationResponse> removeAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return ResponseEntity.ok(notificationService.removeAttachment(notificationService.platformScope(jwt, tenantId), id));
    }

    @GetMapping("/{id}/attachment")
    public ResponseEntity<?> downloadAttachment(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return notificationService.downloadAttachment(notificationService.platformScope(jwt, tenantId), id);
    }
}
