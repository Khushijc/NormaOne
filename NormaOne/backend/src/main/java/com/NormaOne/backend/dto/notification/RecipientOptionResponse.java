package com.NormaOne.backend.dto.notification;

import com.NormaOne.backend.model.core.enums.UserRole;
import com.NormaOne.backend.model.core.enums.UserStatus;
import com.NormaOne.backend.model.core.user;
import com.NormaOne.backend.services.UserAdministration;

/**
 * A member who can be chosen as a recipient of a SELECTED notification: INVITED or ACTIVE, in the
 * notification's tenant. Only what is needed to pick them — the same name and email a notification's
 * recipient list already shows to whoever manages it.
 */
public record RecipientOptionResponse(String id, String name, String email, UserRole role, UserStatus status) {

    public static RecipientOptionResponse of(user u) {
        return new RecipientOptionResponse(u.getId(), u.getName(), u.getEmail(), UserAdministration.accountRole(u), u.getStatus());
    }
}
