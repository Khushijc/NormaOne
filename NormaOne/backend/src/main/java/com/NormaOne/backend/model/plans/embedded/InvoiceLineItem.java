
package com.NormaOne.backend.model.plans.embedded;

import java.math.BigDecimal;

import org.springframework.data.mongodb.core.mapping.Field;
import org.springframework.data.mongodb.core.mapping.FieldType;

import com.NormaOne.backend.model.plans.enums.TaxTreatment;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InvoiceLineItem {

    @NotBlank
    private String description;

    @NotNull
    @Positive
    private BigDecimal quantity;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal unitPrice;

    @Field(targetType = FieldType.DECIMAL128)
    @Builder.Default
    private BigDecimal discountAmount = BigDecimal.ZERO;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxableBase;

    /**
     * Percentage rate, e.g. 21.00 for 21%.
     * The billing service determines the applicable rate.
     */
    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxRate;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxAmount;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal lineTotal;

    @NotNull
    private TaxTreatment taxTreatment;

    private String exemptionReason;
}