package com.NormaOne.backend.controllers;

import java.time.Instant;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
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
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.admin.AuditEventResponse;
import com.NormaOne.backend.dto.admin.CreateTenantUserRequest;
import com.NormaOne.backend.dto.admin.TenantResponse;
import com.NormaOne.backend.dto.admin.UpdateTenantUserRequest;
import com.NormaOne.backend.dto.admin.UserResponse;
import com.NormaOne.backend.dto.admin.UserStatusRequest;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.modules.ModuleAccessRequest;
import com.NormaOne.backend.dto.modules.ModuleAccessResponse;
import com.NormaOne.backend.dto.modules.ModulePermissionsRequest;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.services.TenantAdminService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * Tenant administration of the caller's own organization (ADMIN). The tenant is always
 * taken from the caller's persisted user record, never from the request.
 */
@RestController
@RequestMapping("/api/tenant")
@PreAuthorize("hasRole('ADMIN')")
public class TenantController {

    private final TenantAdminService tenantAdminService;

    public TenantController(TenantAdminService tenantAdminService) {
        this.tenantAdminService = tenantAdminService;
    }

    @GetMapping
    public ResponseEntity<TenantResponse> ownTenant(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(tenantAdminService.ownTenant(jwt));
    }

    @GetMapping("/package")
    public ResponseEntity<TenantPackageResponse> ownPackage(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(tenantAdminService.ownPackage(jwt));
    }

    /** The audit trail of the caller's own organization only (the tenant filter is not a parameter). */
    @GetMapping("/audit-events")
    public ResponseEntity<PageResponse<AuditEventResponse>> auditEvents(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 64) String targetId,
            @RequestParam(required = false) @Size(max = 64) String targetType,
            @RequestParam(required = false) @Size(max = 64) String actorUserId,
            @RequestParam(required = false) AuditAction action,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(tenantAdminService.auditEvents(jwt, targetId, targetType, actorUserId, action, from, to, page, size));
    }

    @GetMapping("/users")
    public ResponseEntity<PageResponse<UserResponse>> listUsers(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(required = false) UserRole role,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(tenantAdminService.listUsers(jwt, search, status, role, page, size));
    }

    @PostMapping("/users")
    public ResponseEntity<UserResponse> createUser(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateTenantUserRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(tenantAdminService.createUser(jwt, request));
    }

    @GetMapping("/users/{userId}")
    public ResponseEntity<UserResponse> getUser(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId) {
        return ResponseEntity.ok(tenantAdminService.getUser(jwt, userId));
    }

    @PatchMapping("/users/{userId}")
    public ResponseEntity<UserResponse> updateUser(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId,
            @Valid @RequestBody UpdateTenantUserRequest request) {
        return ResponseEntity.ok(tenantAdminService.updateUser(jwt, userId, request));
    }

    @PatchMapping("/users/{userId}/status")
    public ResponseEntity<UserResponse> changeUserStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId,
            @Valid @RequestBody UserStatusRequest request) {
        return ResponseEntity.ok(tenantAdminService.changeUserStatus(jwt, userId, request));
    }

    /** Sends a pending invitation again, with a new temporary password from Cognito. */
    @PostMapping("/users/{userId}/resend-invitation")
    public ResponseEntity<UserResponse> resendInvitation(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId) {
        return ResponseEntity.ok(tenantAdminService.resendInvitation(jwt, userId));
    }

    // ==================== MODULE ACCESS ====================

    /** All six modules for this user: assigned or not, and the permissions in each. */
    @GetMapping("/users/{userId}/modules")
    public ResponseEntity<ModuleAccessResponse> getUserModules(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId) {
        return ResponseEntity.ok(tenantAdminService.getUserModules(jwt, userId));
    }

    /** Replaces the user's whole module assignment (only permissions the caller holds). */
    @PutMapping("/users/{userId}/modules")
    public ResponseEntity<ModuleAccessResponse> setUserModules(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId,
            @Valid @RequestBody ModuleAccessRequest request) {
        return ResponseEntity.ok(tenantAdminService.setUserModules(jwt, userId, request));
    }

    /** Assigns one module with exactly these permissions; the other modules are not touched. */
    @PutMapping("/users/{userId}/modules/{moduleId}")
    public ResponseEntity<ModuleAccessResponse> setUserModule(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId,
            @PathVariable ModuleApps moduleId,
            @Valid @RequestBody ModulePermissionsRequest request) {
        return ResponseEntity.ok(tenantAdminService.setUserModule(jwt, userId, moduleId, request));
    }

    /** Revokes one module and every permission in it. */
    @DeleteMapping("/users/{userId}/modules/{moduleId}")
    public ResponseEntity<ModuleAccessResponse> revokeUserModule(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId,
            @PathVariable ModuleApps moduleId) {
        return ResponseEntity.ok(tenantAdminService.revokeUserModule(jwt, userId, moduleId));
    }
}
