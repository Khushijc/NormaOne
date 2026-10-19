package com.NormaOne.backend.model.notification;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.data.mongodb.core.mapping.Document;

import com.NormaOne.backend.model.base.AuditedDocument;
import com.NormaOne.backend.model.notification.enums.OutboundEmailStatus;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * An email waiting to be sent, or already sent: the outbox (EmailOutboxService).
 *
 * It is written only after the business record it is about has been saved, and a failed or
 * impossible delivery never touches that record: the email stays PENDING with its last error and is
 * retried, up to normaone.email.max-attempts, then FAILED. Holds no secrets: recipients, subject,
 * a plain-text body and delivery bookkeeping.
 */
@Document(collection = "email_outbox")
@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public class OutboundEmail extends AuditedDocument {

    @Builder.Default
    private List<String> recipients = new ArrayList<>();

    @NotNull
    private String subject;

    @NotNull
    private String body;

    @NotNull
    @Builder.Default
    private OutboundEmailStatus status = OutboundEmailStatus.PENDING;

    @Builder.Default
    private Integer attempts = 0;
    private Instant lastAttemptAt;
    /** Why the last attempt did not send (no stack traces, no credentials). */
    private String lastError;
    private Instant sentAt;
    /** Earliest time of the next attempt. */
    private Instant nextAttemptAt;
    /** Set while one instance is sending it, so two instances never send it twice. */
    private Instant claimedUntil;

    /** What it is about, e.g. PLAN_CHANGE_REQUEST and that request's id. */
    private String referenceType;
    private String referenceId;
    private String tenantId;
}
