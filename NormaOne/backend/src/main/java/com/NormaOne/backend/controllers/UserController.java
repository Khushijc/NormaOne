package com.NormaOne.backend.controllers;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.user.EmailPreferenceRequest;
import com.NormaOne.backend.dto.user.EmailPreferenceResponse;
import com.NormaOne.backend.dto.user.UserProfileResponse;
import com.NormaOne.backend.services.EmailPreferenceService;
import com.NormaOne.backend.services.UserService;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;
    private final EmailPreferenceService emailPreferences;

    public UserController(UserService userService, EmailPreferenceService emailPreferences) {
        this.userService = userService;
        this.emailPreferences = emailPreferences;
    }

    @GetMapping("/me")
    public ResponseEntity<UserProfileResponse> getCurrentUser(
            @AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(userService.getCurrentUser(jwt));
    }

    /** The caller's own email-notification preference (any active account: SUPER_ADMIN, ADMIN or USER). */
    @GetMapping("/me/email-preference")
    public ResponseEntity<EmailPreferenceResponse> getEmailPreference(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(emailPreferences.own(jwt));
    }

    /** Turns the caller's own email notifications on or off. No user id: always the caller's own account. */
    @PutMapping("/me/email-preference")
    public ResponseEntity<EmailPreferenceResponse> setEmailPreference(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody EmailPreferenceRequest request) {
        return ResponseEntity.ok(emailPreferences.setOwn(jwt, request.enabled()));
    }
}
