package com.NormaOne.backend.controllers;

import java.time.Instant;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.plans.ChangeTenantPlanRequest;
import com.NormaOne.backend.dto.plans.CreatePlanRequest;
import com.NormaOne.backend.dto.plans.PlanChangeDecisionRequest;
import com.NormaOne.backend.dto.plans.PlanChangeRequestResponse;
import com.NormaOne.backend.dto.plans.PlanHistoryResponse;
import com.NormaOne.backend.dto.plans.PlanResponse;
import com.NormaOne.backend.dto.plans.PlanStatusRequest;
import com.NormaOne.backend.dto.plans.SubscriptionHistoryResponse;
import com.NormaOne.backend.dto.plans.TenantSubscriptionResponse;
import com.NormaOne.backend.dto.plans.UpdatePlanRequest;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;
import com.NormaOne.backend.model.plans.enums.PlanHistoryEventType;
import com.NormaOne.backend.model.plans.enums.PlanStatus;
import com.NormaOne.backend.model.plans.enums.SubscriptionStatus;
import com.NormaOne.backend.services.PlanAdminService;
import com.NormaOne.backend.services.PlanChangeService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * Plans ("packages") and tenant subscriptions (SUPER_ADMIN only: the HTTP rule for /api/super-admin/**,
 * @PreAuthorize here, and CurrentUserService in PlanAdminService). Reading one organization's current
 * package stays GET /api/super-admin/tenants/{tenantId}/package (SuperAdminController).
 */
@RestController
@RequestMapping("/api/super-admin")
@PreAuthorize("hasRole('SUPER_ADMIN')")
public class SuperAdminPlanController {

    private final PlanAdminService planAdminService;
    private final PlanChangeService planChangeService;

    public SuperAdminPlanController(PlanAdminService planAdminService, PlanChangeService planChangeService) {
        this.planAdminService = planAdminService;
        this.planChangeService = planChangeService;
    }

    // ==================== PLANS ====================

    @GetMapping("/plans")
    public ResponseEntity<PageResponse<PlanResponse>> listPlans(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) PlanStatus status,
            @RequestParam(required = false) @Size(max = 50) String planCode,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(planAdminService.listPlans(jwt, status, planCode, page, size));
    }

    @PostMapping("/plans")
    public ResponseEntity<PlanResponse> createPlan(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreatePlanRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(planAdminService.createPlan(jwt, request));
    }

    @GetMapping("/plans/{planId}")
    public ResponseEntity<PlanResponse> getPlan(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String planId) {
        return ResponseEntity.ok(planAdminService.getPlan(jwt, planId));
    }

    @PatchMapping("/plans/{planId}")
    public ResponseEntity<PlanResponse> updatePlan(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String planId,
            @Valid @RequestBody UpdatePlanRequest request) {
        return ResponseEntity.ok(planAdminService.updatePlan(jwt, planId, request));
    }

    @PatchMapping("/plans/{planId}/status")
    public ResponseEntity<PlanResponse> changePlanStatus(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String planId,
            @Valid @RequestBody PlanStatusRequest request) {
        return ResponseEntity.ok(planAdminService.changePlanStatus(jwt, planId, request));
    }

    // ==================== SUBSCRIPTIONS ====================

    /** Every organization's current subscription with its plan. */
    @GetMapping("/subscriptions")
    public ResponseEntity<PageResponse<TenantSubscriptionResponse>> listSubscriptions(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) @Size(max = 50) String planCode,
            @RequestParam(required = false) @Size(max = 64) String planId,
            @RequestParam(required = false) SubscriptionStatus status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(planAdminService.listSubscriptions(jwt, planCode, planId, status, page, size));
    }

    /** Moves an organization to another ACTIVE plan version, recorded in its subscription history. */
    @PutMapping("/tenants/{tenantId}/package")
    public ResponseEntity<TenantPackageResponse> changeTenantPlan(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @Valid @RequestBody ChangeTenantPlanRequest request) {
        return ResponseEntity.ok(planAdminService.changeTenantPlan(jwt, tenantId, request));
    }

    @GetMapping("/tenants/{tenantId}/package/history")
    public ResponseEntity<PageResponse<SubscriptionHistoryResponse>> subscriptionHistory(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String tenantId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(planAdminService.subscriptionHistory(jwt, tenantId, page, size));
    }

    // ==================== PLAN HISTORY ====================

    /** Every plan operation across the platform, newest first (PlanHistoryEntry). Dates are ISO-8601 instants, inclusive. */
    @GetMapping("/plan-history")
    public ResponseEntity<PageResponse<PlanHistoryResponse>> planHistory(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) PlanHistoryEventType eventType,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(required = false) @Size(max = 64) String actorUserId,
            @RequestParam(required = false) @Size(max = 64) String planId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(planAdminService.planHistory(jwt, eventType, tenantId, actorUserId, planId, from, to, page, size));
    }

    // ==================== PLAN-CHANGE REQUESTS ====================

    @GetMapping("/plan-change-requests")
    public ResponseEntity<PageResponse<PlanChangeRequestResponse>> planChangeRequests(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) PlanChangeRequestStatus status,
            @RequestParam(required = false) @Size(max = 64) String tenantId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(planChangeService.listAll(jwt, status, tenantId, page, size));
    }

    @GetMapping("/plan-change-requests/{requestId}")
    public ResponseEntity<PlanChangeRequestResponse> planChangeRequest(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String requestId) {
        return ResponseEntity.ok(planChangeService.getAny(jwt, requestId));
    }

    /** Approves a PENDING request and applies the plan to the organization. */
    @PostMapping("/plan-change-requests/{requestId}/approve")
    public ResponseEntity<PlanChangeRequestResponse> approvePlanChange(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String requestId,
            @Valid @RequestBody(required = false) PlanChangeDecisionRequest decision) {
        return ResponseEntity.ok(planChangeService.approve(jwt, requestId, decision));
    }

    /** Rejects a PENDING request; a note is required. */
    @PostMapping("/plan-change-requests/{requestId}/reject")
    public ResponseEntity<PlanChangeRequestResponse> rejectPlanChange(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String requestId,
            @Valid @RequestBody PlanChangeDecisionRequest decision) {
        return ResponseEntity.ok(planChangeService.reject(jwt, requestId, decision));
    }
}
