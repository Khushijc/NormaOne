package com.NormaOne.backend.controllers;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.common.PageResponse;
import com.NormaOne.backend.dto.plans.CreatePlanChangeRequest;
import com.NormaOne.backend.dto.plans.PlanChangeRequestResponse;
import com.NormaOne.backend.dto.plans.TenantPlanResponse;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;
import com.NormaOne.backend.services.PlanChangeService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

/**
 * The plan catalogue and plan-change requests of the caller's own organization (ADMIN). The tenant is
 * always the caller's, from their stored record; the organization's current subscription stays
 * GET /api/tenant/package (TenantController).
 */
@RestController
@RequestMapping("/api/tenant")
@PreAuthorize("hasRole('ADMIN')")
public class TenantPlanController {

    private final PlanChangeService planChangeService;

    public TenantPlanController(PlanChangeService planChangeService) {
        this.planChangeService = planChangeService;
    }

    @GetMapping("/plans")
    public ResponseEntity<List<TenantPlanResponse>> plans(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(planChangeService.catalogue(jwt));
    }

    @GetMapping("/plans/{planId}")
    public ResponseEntity<TenantPlanResponse> plan(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String planId) {
        return ResponseEntity.ok(planChangeService.plan(jwt, planId));
    }

    @PostMapping("/plan-change-requests")
    public ResponseEntity<PlanChangeRequestResponse> request(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreatePlanChangeRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(planChangeService.request(jwt, request));
    }

    @GetMapping("/plan-change-requests")
    public ResponseEntity<PageResponse<PlanChangeRequestResponse>> requests(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(required = false) PlanChangeRequestStatus status,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return ResponseEntity.ok(planChangeService.listOwn(jwt, status, page, size));
    }

    @GetMapping("/plan-change-requests/{requestId}")
    public ResponseEntity<PlanChangeRequestResponse> getRequest(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String requestId) {
        return ResponseEntity.ok(planChangeService.getOwn(jwt, requestId));
    }

    @PostMapping("/plan-change-requests/{requestId}/cancel")
    public ResponseEntity<PlanChangeRequestResponse> cancelRequest(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable @Size(min = 1, max = 64) String requestId) {
        return ResponseEntity.ok(planChangeService.cancelOwn(jwt, requestId));
    }
}
