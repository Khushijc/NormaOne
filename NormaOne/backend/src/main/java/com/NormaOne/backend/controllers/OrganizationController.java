package com.NormaOne.backend.controllers;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.tenant.OrganizationResponse;
import com.NormaOne.backend.exceptions.ResourceNotFoundException;
import com.NormaOne.backend.security.CurrentUser;
import com.NormaOne.backend.security.CurrentUserService;

/**
 * GET /api/organization — the caller's own organization, read only, for any member (ADMIN or USER).
 *
 * THERE IS NO WAY TO NAME ANOTHER ONE. The endpoint takes no id, path variable or parameter: the
 * organization is the tenant on the caller's stored user record, resolved from the validated token's
 * sub. A ?tenantId= or a body is simply not read. Listing organizations stays a Super Admin feature
 * (/api/super-admin/tenants), and the administrators' fuller view stays /api/tenant.
 *
 * Not under /api/tenant because everything there is ADMIN-only by SecurityConfig and by
 * TenantController's @PreAuthorize; this is the member-level read.
 */
@RestController
@RequestMapping("/api/organization")
@PreAuthorize("hasAnyRole('ADMIN', 'USER')")
public class OrganizationController {

    private final CurrentUserService currentUserService;

    public OrganizationController(CurrentUserService currentUserService) {
        this.currentUserService = currentUserService;
    }

    @GetMapping
    public ResponseEntity<OrganizationResponse> ownOrganization(@AuthenticationPrincipal Jwt jwt) {
        CurrentUser member = currentUserService.requireTenantMember(jwt);
        if (member.tenant() == null) {
            throw new ResourceNotFoundException("Your account is not associated with an organization.");
        }
        return ResponseEntity.ok(OrganizationResponse.of(member.tenant()));
    }
}
