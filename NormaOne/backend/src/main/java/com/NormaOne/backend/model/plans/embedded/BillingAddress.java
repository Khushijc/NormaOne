
package com.NormaOne.backend.model.plans.embedded;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BillingAddress {

    @NotBlank
    @Size(max = 200)
    private String street;

    @NotBlank
    @Size(max = 100)
    private String city;

    @Size(max = 100)
    private String province;

    @Size(max = 20)
    private String postalCode;

    @NotBlank
    @Builder.Default
    private String countryCode = "ES";
}