package com.NormaOne.backend.dto.user;

import jakarta.validation.constraints.NotNull;

/**
 * Turns email notifications on or off. There is deliberately no user or organization field: the
 * account is the caller's own, or the one named in the administrator route's path.
 */
public record EmailPreferenceRequest(
        @NotNull(message = "enabled is required (true or false)")
        Boolean enabled
) {}
