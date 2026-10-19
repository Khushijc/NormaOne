package com.NormaOne.backend.dto.admin;

import com.NormaOne.backend.model.core.Tenant;
import com.NormaOne.backend.model.core.enums.TenantStatus;
import com.fasterxml.jackson.annotation.JsonInclude;

/** The organization an account belongs to, as shown beside an administrator or a user. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrganizationSummary(String id, String name, String subdomain, TenantStatus status) {

    /** The tenant's summary, or just its id when the tenant record no longer exists. */
    public static OrganizationSummary of(String tenantId, Tenant t) {
        if (t == null) {
            return tenantId == null ? null : new OrganizationSummary(tenantId, null, null, null);
        }
        return new OrganizationSummary(t.getId(), t.getTenantName(), t.getSubdomain(), t.getStatus());
    }
}
