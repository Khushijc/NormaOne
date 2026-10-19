
package com.NormaOne.backend.model.plans.embedded;

import java.math.BigDecimal;

import org.springframework.data.mongodb.core.mapping.Field;
import org.springframework.data.mongodb.core.mapping.FieldType;

import com.NormaOne.backend.model.plans.enums.TaxTreatment;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TaxBreakdown {

    @NotNull
    private TaxTreatment taxTreatment;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxRate;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxableBase;

    @NotNull
    @DecimalMin("0.00")
    @Field(targetType = FieldType.DECIMAL128)
    private BigDecimal taxAmount;

    private String exemptionReason;
}