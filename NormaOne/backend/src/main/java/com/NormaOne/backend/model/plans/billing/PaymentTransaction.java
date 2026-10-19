
package com.NormaOne.backend.model.plans.billing;

import java.math.BigDecimal;
import java.time.Instant;

import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;
import org.springframework.data.mongodb.core.mapping.FieldType;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.plans.enums.PaymentMethodType;
import com.NormaOne.backend.model.plans.enums.PaymentStatus;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

@Document(collection = "payment_transactions")
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class PaymentTransaction extends TenantBase {

    @NotBlank
    @Indexed
    private String tenantSubscriptionDocId;

    @NotBlank
    @Indexed
    private String invoiceId;

    @NotBlank
    @Indexed
    private String transactionReference;

    @NotBlank
    private String paymentProvider;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal amount;

    @NotBlank
    @Builder.Default
    private String currencyCode = "EUR";

    @NotNull
    private PaymentMethodType paymentMethodType;

    @NotNull
    @Builder.Default
    private PaymentStatus status = PaymentStatus.PENDING;

    @NotNull
    private Instant initiatedAt;

    private Instant completedAt;

    @Size(max = 500)
    private String failureReason;

    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    @Builder.Default
    private BigDecimal refundAmount = BigDecimal.ZERO;

    private Instant refundedAt;

    private String providerPaymentReference;
}