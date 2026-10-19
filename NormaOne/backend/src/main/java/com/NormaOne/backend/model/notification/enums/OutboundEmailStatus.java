package com.NormaOne.backend.model.notification.enums;

/** Delivery state of an outbox email (OutboundEmail). */
public enum OutboundEmailStatus {
    /** Not sent yet: waiting for its first attempt, a retry, or for email delivery to be configured. */
    PENDING,
    /** Handed to the mail server. */
    SENT,
    /** Gave up after normaone.email.max-attempts, or there was nobody to send it to. */
    FAILED
}
