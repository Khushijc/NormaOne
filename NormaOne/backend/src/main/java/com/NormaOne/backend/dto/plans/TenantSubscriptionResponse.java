package com.NormaOne.backend.dto.plans;

import com.NormaOne.backend.dto.admin.OrganizationSummary;
import com.NormaOne.backend.dto.tenant.TenantPackageResponse;

/** One organization's current subscription with the plan it references, for the cross-tenant list. */
public record TenantSubscriptionResponse(
        OrganizationSummary organization,
        TenantPackageResponse subscription
) {}
