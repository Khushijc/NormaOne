package com.NormaOne.backend.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.onboarding.OnboardingStatusResponse;
import com.NormaOne.backend.dto.onboarding.TenantOnboardingRequest;
import com.NormaOne.backend.dto.onboarding.TenantOnboardingResponse;
import com.NormaOne.backend.services.OnboardingService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/onboarding")
public class OnboardingController {

    private final OnboardingService onboardingService;

    public OnboardingController(OnboardingService onboardingService) {
        this.onboardingService = onboardingService;
    }

    @PostMapping("/tenant")
    public ResponseEntity<TenantOnboardingResponse> onboardTenant(
            @Valid @RequestBody TenantOnboardingRequest request,
            @AuthenticationPrincipal Jwt jwt) {

        TenantOnboardingResponse response = onboardingService.onboardTenant(request, jwt);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /** Whether the caller still has to complete tenant onboarding. */
    @GetMapping("/status")
    public ResponseEntity<OnboardingStatusResponse> status(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(onboardingService.status(jwt));
    }
}
