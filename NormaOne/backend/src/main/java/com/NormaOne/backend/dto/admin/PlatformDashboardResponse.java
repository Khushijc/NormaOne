package com.NormaOne.backend.dto.admin;

import java.util.Map;

/**
 * GET /api/super-admin/dashboard: platform-wide counts, each computed by a database aggregation.
 *
 * "Active" is status ACTIVE; "inactive" is SUSPENDED plus DEACTIVATED. INVITED accounts are in
 * neither — they are pending — and appear in the by-status maps. Admins are tenant ADMIN records;
 * users are regular USER records; Super Admins are counted on their own.
 */
public record PlatformDashboardResponse(
        long totalOrganizations,
        Map<String, Long> organizationsByStatus,
        long totalAdmins,
        long activeAdmins,
        long inactiveAdmins,
        Map<String, Long> adminsByStatus,
        long totalUsers,
        long activeUsers,
        long inactiveUsers,
        Map<String, Long> usersByStatus,
        long totalSuperAdmins,
        Map<String, Long> currentSubscriptionsByPlan
) {}
