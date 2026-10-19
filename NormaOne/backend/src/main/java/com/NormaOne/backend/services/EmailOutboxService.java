package com.NormaOne.backend.services;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.model.notification.OutboundEmail;
import com.NormaOne.backend.model.notification.enums.OutboundEmailStatus;
import com.NormaOne.backend.repositories.OutboundEmailRepository;

/**
 * The email outbox: emails are written here AFTER the record they are about has been saved, then
 * sent, and retried when sending fails — so an email failure never loses or undoes the record, and
 * nothing is announced that was not saved.
 *
 * Delivery happens right after {@link #enqueue} (in the same request) and again from a scheduled
 * retry every normaone.email.retry-interval (PT5M by default) for PENDING emails whose next attempt
 * is due. Each attempt first claims the email (claimedUntil), so two instances never send it twice.
 * While email delivery is not configured (EmailSender.configured), emails stay PENDING untouched,
 * with lastError saying so, and are sent once it is.
 */
@Service
public class EmailOutboxService {

    private static final Logger log = LoggerFactory.getLogger(EmailOutboxService.class);
    private static final Duration CLAIM = Duration.ofMinutes(2);
    static final String NOT_CONFIGURED = "Email delivery is not configured (normaone.email.from; for SMTP also spring.mail.host).";

    private final OutboundEmailRepository repository;
    private final MongoTemplate mongoTemplate;
    private final EmailSender sender;
    private final NormaOneProperties properties;

    public EmailOutboxService(OutboundEmailRepository repository, MongoTemplate mongoTemplate, EmailSender sender,
            NormaOneProperties properties) {
        this.repository = repository;
        this.mongoTemplate = mongoTemplate;
        this.sender = sender;
        this.properties = properties;
    }

    /**
     * Writes an email to the outbox and tries to send it now. Never throws: the caller's record is
     * already saved, and an outbox problem is logged (and visible as the email's status) instead.
     * Returns the email as it stands after the first attempt, or empty if it could not even be written.
     */
    public Optional<OutboundEmail> enqueue(List<String> recipients, String subject, String body, String referenceType,
            String referenceId, String tenantId) {
        OutboundEmail saved;
        try {
            List<String> to = recipients == null ? List.of()
                    : recipients.stream().filter(r -> r != null && !r.isBlank()).map(String::trim).distinct().toList();
            saved = repository.insert(OutboundEmail.builder()
                    .recipients(to)
                    .subject(subject)
                    .body(body)
                    .status(to.isEmpty() ? OutboundEmailStatus.FAILED : OutboundEmailStatus.PENDING)
                    .lastError(to.isEmpty() ? "No recipient: there is no ACTIVE Super Admin and normaone.email.plan-change-recipients is empty." : null)
                    .nextAttemptAt(Instant.now())
                    .referenceType(referenceType)
                    .referenceId(referenceId)
                    .tenantId(tenantId)
                    .build());
        } catch (RuntimeException ex) {
            log.error("Could not write the {} email for {} {} to the outbox: {}", subject, referenceType, referenceId, ex.getMessage());
            return Optional.empty();
        }
        if (saved.getStatus() == OutboundEmailStatus.FAILED) {
            log.warn("Email for {} {} has no recipient; it was recorded as FAILED.", referenceType, referenceId);
            return Optional.of(saved);
        }
        return Optional.of(attempt(saved.getId()).orElse(saved));
    }

    /** The latest email about a record, if any. */
    public Optional<OutboundEmail> latestFor(String referenceType, String referenceId) {
        return repository.findFirstByReferenceTypeAndReferenceIdOrderByCreatedAtDesc(referenceType, referenceId);
    }

    /** Retries due PENDING emails. Does nothing while delivery is not configured. */
    @Scheduled(fixedDelayString = "${normaone.email.retry-interval:PT5M}", initialDelayString = "${normaone.email.retry-interval:PT5M}")
    public void retryDue() {
        if (!sender.configured()) {
            return;
        }
        Query due = new Query(Criteria.where("status").is(OutboundEmailStatus.PENDING).and("nextAttemptAt").lte(Instant.now()))
                .limit(50);
        due.fields().include("id");
        for (OutboundEmail email : mongoTemplate.find(due, OutboundEmail.class)) {
            attempt(email.getId());
        }
    }

    /**
     * One delivery attempt, if this instance can claim the email. Returns the email afterwards, or
     * empty when another instance holds it or it is no longer PENDING.
     */
    Optional<OutboundEmail> attempt(String id) {
        if (!sender.configured()) {
            mongoTemplate.updateFirst(new Query(Criteria.where("id").is(id).and("status").is(OutboundEmailStatus.PENDING)),
                    new Update().set("lastError", NOT_CONFIGURED), OutboundEmail.class);
            return repository.findById(id);
        }
        Instant now = Instant.now();
        OutboundEmail claimed = mongoTemplate.findAndModify(
                new Query(new Criteria().andOperator(
                        Criteria.where("id").is(id),
                        Criteria.where("status").is(OutboundEmailStatus.PENDING),
                        new Criteria().orOperator(Criteria.where("claimedUntil").exists(false), Criteria.where("claimedUntil").is(null),
                                Criteria.where("claimedUntil").lt(now)))),
                new Update().set("claimedUntil", now.plus(CLAIM)).inc("attempts", 1).set("lastAttemptAt", now),
                FindAndModifyOptions.options().returnNew(true),
                OutboundEmail.class);
        if (claimed == null) {
            return Optional.empty();
        }
        Update outcome;
        try {
            sender.send(claimed.getRecipients(), claimed.getSubject(), claimed.getBody());
            outcome = new Update().set("status", OutboundEmailStatus.SENT).set("sentAt", Instant.now()).unset("lastError")
                    .unset("claimedUntil").unset("nextAttemptAt");
        } catch (RuntimeException ex) {
            boolean giveUp = claimed.getAttempts() >= Math.max(properties.getEmail().getMaxAttempts(), 1);
            String error = ex.getClass().getSimpleName() + (ex.getMessage() != null ? ": " + ex.getMessage() : "");
            log.warn("Email {} ({} {}) not sent, attempt {}: {}", claimed.getId(), claimed.getReferenceType(), claimed.getReferenceId(),
                    claimed.getAttempts(), error);
            outcome = new Update().set("lastError", error.length() > 500 ? error.substring(0, 500) : error).unset("claimedUntil")
                    .set("status", giveUp ? OutboundEmailStatus.FAILED : OutboundEmailStatus.PENDING)
                    .set("nextAttemptAt", now.plus(backoff(claimed.getAttempts())));
        }
        mongoTemplate.updateFirst(new Query(Criteria.where("id").is(claimed.getId())), outcome, OutboundEmail.class);
        return repository.findById(claimed.getId());
    }

    /** 1, 2, 4, 8 … minutes, at most an hour. */
    private static Duration backoff(int attempts) {
        return Duration.ofMinutes(Math.min(60, 1L << Math.min(Math.max(attempts - 1, 0), 6)));
    }
}
