package com.NormaOne.backend.dto.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record VerifyEmailRequest(
        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid email address")
        @Size(max = 254, message = "Email must not exceed 254 characters")
        String email,

        @NotBlank(message = "Verification code is required")
        @Size(max = 20, message = "Verification code must not exceed 20 characters")
        String code,

        @Size(min = 8, max = 256, message = "Password must be between 8 and 256 characters")
        String password
) {
    public VerifyEmailRequest(String email, String code) {
        this(email, code, null);
    }
}