
package com.NormaOne.backend.model.plans.enums;

public enum BillingEventType {
    INVOICE_ISSUED,
    PAYMENT_INITIATED,
    PAYMENT_SUCCEEDED,
    PAYMENT_FAILED,
    REFUND_SUCCEEDED,
    SUBSCRIPTION_RENEWED,
    PROVIDER_WEBHOOK_RECEIVED
}
