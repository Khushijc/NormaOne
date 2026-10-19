
package com.NormaOne.backend.model.plans.embedded;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
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
public class BillingParty {

    @NotBlank
    @Size(max = 200)
    private String legalName;

    @Size(max = 30)
    private String taxIdentificationNumber;

    @Valid
    private BillingAddress billingAddress;

    @Email
    @Size(max = 254)
    private String emailAddress;
}