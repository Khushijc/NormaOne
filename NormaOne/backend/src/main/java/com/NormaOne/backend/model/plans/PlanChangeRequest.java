package com.NormaOne.backend.model.plans;

import java.time.Instant;

import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.plans.enums.PlanChangeRequestStatus;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * A Tenant Admin's request to move their organization to another plan. There is no billing or payment
 * integration, so a change is never applied on the Tenant Admin's word alone: the request waits
 * (PENDING) until a Super Admin approves it — which applies it through PackageService.changePackage —
 * or rejects it. The tenant comes from the requesting admin's own record, never from the request body.
 *
 * {@code open} is true while PENDING or PROCESSING; a unique partial index on {tenantId} where open is
 * true allows one open request per organization (MongoIndexInitializer).
 */
@Document(collection = "plan_change_requests")
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class PlanChangeRequest extends TenantBase {

    @NotNull
    @Builder.Default
    private PlanChangeRequestStatus status = PlanChangeRequestStatus.PENDING;

    @NotNull
    @Builder.Default
    private Boolean open = true;

    // ==================== WHO ASKED ====================

    @NotBlank
    private String requestedByUserId;
    private String requestedByName;
    private String requestedByEmail;
    @NotNull
    private Instant requestedAt;

    @Size(max = 500)
    private String reason;

    // ==================== THE PLANS (as they were when asked) ====================

    private String currentPlanId;
    private String currentPlanCode;
    private Integer currentPlanVersion;
    private String currentPlanName;

    @NotBlank
    private String requestedPlanId;
    private String requestedPlanCode;
    private Integer requestedPlanVersion;
    private String requestedPlanName;

    // ==================== THE DECISION ====================

    private String decidedByUserId;
    private String decidedByRole;
    private Instant decidedAt;
    @Size(max = 500)
    private String decisionNote;

    /** When an approval started being applied (PROCESSING); a stale one may be decided again. */
    private Instant processingStartedAt;

    /** The subscription the approval created. */
    private String appliedSubscriptionId;
}
