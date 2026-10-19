package com.NormaOne.backend.dto.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST /api/auth/new-password: the permanent password that answers a NEW_PASSWORD_REQUIRED challenge.
 *
 * A browser sends only {@code email} and {@code newPassword}; the challenge session travels in the
 * HttpOnly NORMAONE_CHALLENGE cookie set by the login. {@code session} is for a non-browser client that
 * logged in with X-Token-Delivery: body and received the challenge session in the body. The password is
 * never logged or stored; Cognito checks it against the pool's policy.
 */
public record NewPasswordRequest(

        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid email address")
        @Size(max = 254, message = "Email must not exceed 254 characters")
        String email,

        @NotBlank(message = "A new password is required")
        @Size(min = 8, max = 256, message = "The new password must be 8 to 256 characters")
        String newPassword,

        @Size(max = 4096, message = "Session is too long")
        String session
) {
    /** Never prints the password, should the record ever be logged. */
    @Override
    public String toString() {
        return "NewPasswordRequest[email=" + email + ", newPassword=***]";
    }
}
