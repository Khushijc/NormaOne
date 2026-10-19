
package com.NormaOne.backend.model.plans.billing;

import java.time.Instant;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.plans.enums.BillingEventType;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

@Document(collection = "billing_events")
@CompoundIndexes({
    @CompoundIndex(
        name = "provider_event_uniq",
        def = "{'providerEventId': 1}",
        unique = true,
        sparse = true
    ),
    @CompoundIndex(
        name = "billing_event_timeline_idx",
        def = "{'tenantId': 1, 'receivedAt': -1}"
    )
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class BillingEvent extends TenantBase {

    @NotNull
    private BillingEventType eventType;

    @NotBlank
    private String transactionReference;

    private String providerEventId;

    @NotNull
    private Instant receivedAt;

    private Instant processedAt;

    @NotBlank
    @Builder.Default
    private String processingStatus = "PENDING";

    @Size(max = 500)
    private String failureReason;
}