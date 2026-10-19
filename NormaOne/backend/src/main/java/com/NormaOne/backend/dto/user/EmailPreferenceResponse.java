package com.NormaOne.backend.dto.user;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.services.EmailPreferenceService;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * One account's email-notification preference.
 *
 * {@code emailNotificationsEnabled} is the effective value; {@code explicit} says whether it was set
 * (false = the documented default, enabled). {@code emailDeliveryAvailable} is false while no email
 * provider is configured: the preference is stored and applies once email delivery exists, and
 * nothing is emailed until then (the screens say "Coming Soon").
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EmailPreferenceResponse(
        String userId,
        String name,
        String email,
        UserRole role,
        boolean emailNotificationsEnabled,
        boolean explicit,
        boolean emailDeliveryAvailable
) {
    public static EmailPreferenceResponse of(user u, UserRole role, boolean deliveryAvailable) {
        return new EmailPreferenceResponse(u.getId(), u.getName(), u.getEmail(), role, EmailPreferenceService.enabled(u),
                u.getEmailNotificationsEnabled() != null, deliveryAvailable);
    }
}
