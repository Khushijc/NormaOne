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

import com.NormaOne.backend.dto.admin.AdminResponse;
import com.NormaOne.backend.dto.admin.AuditEventResponse;
import com.NormaOne.backend.dto.admin.CreateAdminRequest;
import com.NormaOne.backend.dto.admin.CreateSuperAdminRequest;
import com.NormaOne.backend.dto.admin.CreateTenantRequest;
import com.NormaOne.backend.dto.admin.PlatformAccountResponse;
import com.NormaOne.backend.dto.admin.PlatformDashboardResponse;
import com.NormaOne.backend.dto.admin.PlatformUserResponse;
import com.NormaOne.backend.dto.admin.SuperAdminResponse;
import com.NormaOne.backend.dto.admin.TenantResponse;
import com.NormaOne.backend.dto.admin.TenantStatusRequest;
import com.NormaOne.backend.dto.admin.UpdateAdminRequest;
import com.NormaOne.backend.dto.admin.UpdateTenantRequest;
import com.NormaOne.backend.dto.admin.UserStatusRequest;
import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.modules.ModuleAccessRequest;
import com.NormaOne.backend.dto.modules.ModuleAccessResponse;
import com.NormaOne.backend.dto.modules.ModulePermissionsRequest;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.model.audit.AuditAction;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.plans.enums.ModuleApps;
import com.NormaOne.backend.services.AuditService;
import com.NormaOne.backend.services.PlatformAccountService;
import com.NormaOne.backend.services.SuperAdminAccountService;
import com.NormaOne.backend.services.SuperAdminService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * Platform administration (SUPER_ADMIN only).
 *
 * Three layers check the role, each against the database rather than the token: the HTTP rule in
 * SecurityConfig, @PreAuthorize here, and CurrentUserService in every service method.
 *
 * WHAT IS DELIBERATELY ABSENT. No route creates, edits, deletes or changes the status or role of a
 * regular user — /users is GET only, so any other method there is answered 405. No route changes an
 * existing account's role: administrators are always ADMIN, and a Super Admin is either the first
 * one (SuperAdminBootstrap, configuration only) or invited as a new platform account by an active
 * Super Admin (/super-admins). A tenant account is never promoted.
 */
@RestController
@RequestMapping("/api/super-admin")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class SuperAdminController {

    private final SuperAdminService superAdminService;
    private final SuperAdminAccountService accountService;
    private final PlatformAccountService platformAccountService;

    public SuperAdminController(SuperAdminService superAdminService, SuperAdminAccountService accountService,
            PlatformAccountService platformAccountService) {
        this.superAdminService = superAdminService;
        this.accountService = accountService;
        this.platformAccountService = platformAccountService;
    }

    // ==================== SUPER ADMINS ====================

    @GetMapping("/super-admins")
    public ResponseEntity<PageResponse<SuperAdminResponse>> listSuperAdmins(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(platformAccountService.listSuperAdmins(jwt, search, status, page, size));
    }

    /** Invites another Super Admin: a platform account, emailed a temporary password by Cognito. */
    @PostMapping("/super-admins")
    public ResponseEntity<SuperAdminResponse> createSuperAdmin(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateSuperAdminRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(platformAccountService.createSuperAdmin(jwt, request));
    }

    @GetMapping("/super-admins/{id}")
    public ResponseEntity<SuperAdminResponse> getSuperAdmin(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return ResponseEntity.ok(platformAccountService.getSuperAdmin(jwt, id));
    }

    @PatchMapping("/super-admins/{id}/status")
    public ResponseEntity<SuperAdminResponse> changeSuperAdminStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String id,
            @Valid @RequestBody UserStatusRequest request) {
        return ResponseEntity.ok(platformAccountService.changeSuperAdminStatus(jwt, id, request));
    }

    @PostMapping("/super-admins/{id}/resend-invitation")
    public ResponseEntity<SuperAdminResponse> resendSuperAdminInvitation(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String id) {
        return ResponseEntity.ok(platformAccountService.resendSuperAdminInvitation(jwt, id));
    }

    // ==================== ACCOUNT DIRECTORY (READ ONLY) ====================

    /** Every account across tenants and the platform, filtered by search, role, tenant, status and module. */
    @GetMapping("/accounts")
    public ResponseEntity<PageResponse<PlatformAccountResponse>> listAccounts(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) UserRole role,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(required = false) ModuleApps module,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(platformAccountService.listAccounts(jwt, search, role, tenantId, status, module, page, size));
    }

    // ==================== DASHBOARD ====================

    /** Platform-wide counts. {@code /summary} is the earlier name of the same read, kept so existing clients work. */
    @GetMapping({"/dashboard", "/summary"})
    public ResponseEntity<PlatformDashboardResponse> dashboard(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(superAdminService.dashboard(jwt));
    }

    // ==================== ORGANIZATIONS ====================

    @GetMapping("/tenants")
    public ResponseEntity<PageResponse<TenantResponse>> listTenants(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) TenantStatus status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(superAdminService.listTenants(jwt, search, status, page, size));
    }

    @PostMapping("/tenants")
    public ResponseEntity<TenantResponse> createTenant(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateTenantRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(superAdminService.createTenant(jwt, request));
    }

    @GetMapping("/tenants/{tenantId}")
    public ResponseEntity<TenantResponse> getTenant(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId) {
        return ResponseEntity.ok(superAdminService.getTenant(jwt, tenantId));
    }

    @PatchMapping("/tenants/{tenantId}")
    public ResponseEntity<TenantResponse> updateTenant(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @Valid @RequestBody UpdateTenantRequest request) {
        return ResponseEntity.ok(superAdminService.updateTenant(jwt, tenantId, request));
    }

    @PatchMapping("/tenants/{tenantId}/status")
    public ResponseEntity<TenantResponse> changeTenantStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @Valid @RequestBody TenantStatusRequest request) {
        return ResponseEntity.ok(superAdminService.changeTenantStatus(jwt, tenantId, request));
    }

    @GetMapping("/tenants/{tenantId}/package")
    public ResponseEntity<TenantPackageResponse> getTenantPackage(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId) {
        return ResponseEntity.ok(superAdminService.getTenantPackage(jwt, tenantId));
    }

    // ==================== ADMINISTRATORS ====================

    @GetMapping("/admins")
    public ResponseEntity<PageResponse<AdminResponse>> listAdmins(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(accountService.listAdmins(jwt, search, tenantId, status, page, size));
    }

    @PostMapping("/admins")
    public ResponseEntity<AdminResponse> createAdmin(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateAdminRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(accountService.createAdmin(jwt, request));
    }

    @GetMapping("/admins/{adminId}")
    public ResponseEntity<AdminResponse> getAdmin(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId) {
        return ResponseEntity.ok(accountService.getAdmin(jwt, adminId));
    }

    @PutMapping("/admins/{adminId}")
    public ResponseEntity<AdminResponse> updateAdmin(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId,
            @Valid @RequestBody UpdateAdminRequest request) {
        return ResponseEntity.ok(accountService.updateAdmin(jwt, adminId, request));
    }

    @PatchMapping("/admins/{adminId}/status")
    public ResponseEntity<AdminResponse> changeAdminStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId,
            @Valid @RequestBody UserStatusRequest request) {
        return ResponseEntity.ok(accountService.changeAdminStatus(jwt, adminId, request));
    }

    /** Sends a pending administrator invitation again, with a new temporary password from Cognito. */
    @PostMapping("/admins/{adminId}/resend-invitation")
    public ResponseEntity<AdminResponse> resendAdminInvitation(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId) {
        return ResponseEntity.ok(accountService.resendAdminInvitation(jwt, adminId));
    }

    /** The administrator's module assignment and what is effective now, module by module. */
    @GetMapping("/admins/{adminId}/modules")
    public ResponseEntity<ModuleAccessResponse> getAdminModules(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId) {
        return ResponseEntity.ok(accountService.getAdminModules(jwt, adminId));
    }

    @PutMapping("/admins/{adminId}/modules")
    public ResponseEntity<ModuleAccessResponse> setAdminModules(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId,
            @Valid @RequestBody ModuleAccessRequest request) {
        return ResponseEntity.ok(accountService.setAdminModules(jwt, adminId, request));
    }

    /** Assigns one module to the administrator with exactly these permissions; their other modules are kept. */
    @PutMapping("/admins/{adminId}/modules/{moduleId}")
    public ResponseEntity<ModuleAccessResponse> setAdminModule(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId,
            @PathVariable ModuleApps moduleId,
            @Valid @RequestBody ModulePermissionsRequest request) {
        return ResponseEntity.ok(accountService.setAdminModule(jwt, adminId, moduleId, request));
    }

    /** Revokes one module, and every permission in it, from the administrator. */
    @DeleteMapping("/admins/{adminId}/modules/{moduleId}")
    public ResponseEntity<ModuleAccessResponse> revokeAdminModule(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String adminId,
            @PathVariable ModuleApps moduleId) {
        return ResponseEntity.ok(accountService.revokeAdminModule(jwt, adminId, moduleId));
    }

    // ==================== REGULAR USERS (READ ONLY) ====================

    @GetMapping("/users")
    public ResponseEntity<PageResponse<PlatformUserResponse>> listUsers(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 100) String search,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(required = false) UserStatus status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(accountService.listUsers(jwt, search, tenantId, status, page, size));
    }

    @GetMapping("/users/{userId}")
    public ResponseEntity<PlatformUserResponse> getUser(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String userId) {
        return ResponseEntity.ok(accountService.getUser(jwt, userId));
    }

    // ==================== AUDIT (READ ONLY) ====================

    @GetMapping("/audit-events")
    public ResponseEntity<PageResponse<AuditEventResponse>> listAuditEvents(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(required = false) @Size(max = 64) String targetId,
            @RequestParam(required = false) @Size(max = 64) String actorUserId,
            @RequestParam(required = false) AuditAction action,
            @RequestParam(required = false) @Size(max = 64) String targetType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(accountService.listAuditEvents(jwt,
                new AuditService.Filter(tenantId, targetId, targetType, actorUserId, action, from, to), page, size));
    }
}
