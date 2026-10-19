
package com.NormaOne.backend.model.plans.billing;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;
import org.springframework.data.mongodb.core.mapping.FieldType;

import com.NormaOne.backend.model.base.TenantBase;
import com.NormaOne.backend.model.plans.embedded.BillingParty;
import com.NormaOne.backend.model.plans.embedded.InvoiceLineItem;
import com.NormaOne.backend.model.plans.embedded.TaxBreakdown;
import com.NormaOne.backend.model.plans.enums.InvoiceStatus;

import jakarta.validation.Valid;
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

@Document(collection = "invoices")
@CompoundIndexes({
    @CompoundIndex(
        name = "invoice_number_series_tenant_uniq",
        def = "{'tenantId': 1, 'invoiceSeries': 1, 'invoiceNumber': 1}",
        unique = true
    ),
    @CompoundIndex(
        name = "invoice_subscription_date_idx",
        def = "{'tenantSubscriptionId': 1, 'issueDate': -1}"
    )
})
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class Invoice extends TenantBase {

    @NotBlank
    private String tenantSubscriptionDocId;

    @NotBlank
    @Size(max = 50)
    private String invoiceSeries;

    @NotBlank
    @Size(max = 50)
    private String invoiceNumber;

    @NotNull
    private Instant issueDate;

    private Instant operationDate;

    @Valid
    @NotNull
    private BillingParty issuerDetails;

    @Valid
    @NotNull
    private BillingParty customerDetails;

    @Valid
    @NotNull
    @Builder.Default
    private List<InvoiceLineItem> lineItems = new ArrayList<>();

    @Valid
    @Builder.Default
    private List<TaxBreakdown> taxBreakdowns = new ArrayList<>();

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal subtotal;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxTotal;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal totalAmount;

    @NotBlank
    @Builder.Default
    private String currencyCode = "EUR";

    @NotNull
    @Builder.Default
    private InvoiceStatus status = InvoiceStatus.DRAFT;

    /**
     * Reference to the invoice being corrected, if applicable.
     */
    private String correctsInvoiceId;

    private Instant paidAt;

    /**
     * Link or reference to the issued invoice document.
     */
    private String documentReference;
}