package com.NormaOne.backend.services;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Supplier;

import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;

import com.NormaOne.backend.exceptions.ConflictException;

/**
 * Short exclusive locks on a named resource, held in MongoDB ({@code resource_locks}), so a
 * check-then-write sequence cannot interleave with another one on the same resource — across threads
 * and across application instances, on a standalone server as on a replica set.
 *
 * Used where a rule spans several documents: an organization's user seats ("seats:{tenantId}") and the
 * platform's active Super Admins ("super-admins").
 *
 * A lock is one document {_id: key, owner, lockedUntil}. Taking it is an atomic upsert that only
 * matches when the lock is free or expired; a held lock makes the upsert collide on _id, and the caller
 * retries for up to {@link #WAIT}. A lock is released by its owner only, and expires after
 * {@link #LEASE} on its own, so a crashed instance never blocks the resource for long.
 */
@Service
public class ResourceLockService {

    private static final Logger log = LoggerFactory.getLogger(ResourceLockService.class);
    static final String COLLECTION = "resource_locks";
    /** How long a lock is held at most (a crashed holder's lock expires after this). */
    static final Duration LEASE = Duration.ofSeconds(30);
    /** How long a caller waits for a held lock before giving up with 409. */
    static final Duration WAIT = Duration.ofSeconds(10);

    private final MongoTemplate mongoTemplate;

    public ResourceLockService(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    /** Runs {@code work} while holding the lock on {@code key}. */
    public <T> T withLock(String key, Supplier<T> work) {
        String owner = acquire(key);
        try {
            return work.get();
        } finally {
            release(key, owner);
        }
    }

    private String acquire(String key) {
        String owner = UUID.randomUUID().toString();
        Instant deadline = Instant.now().plus(WAIT);
        long pause = 10;
        while (true) {
            Instant now = Instant.now();
            try {
                Document taken = mongoTemplate.findAndModify(
                        new Query(new Criteria().andOperator(Criteria.where("_id").is(key),
                                new Criteria().orOperator(Criteria.where("lockedUntil").exists(false), Criteria.where("lockedUntil").lt(now)))),
                        new Update().set("owner", owner).set("lockedUntil", now.plus(LEASE)),
                        FindAndModifyOptions.options().upsert(true).returnNew(true),
                        Document.class, COLLECTION);
                if (taken != null && owner.equals(taken.getString("owner"))) {
                    return owner;
                }
            } catch (DuplicateKeyException held) {
                // Held by someone else: the upsert tried to create a second document with this key.
            }
            if (Instant.now().isAfter(deadline)) {
                throw new ConflictException("Another change to the same resource is in progress. Try again in a moment.");
            }
            sleep(pause);
            pause = Math.min(pause * 2, 200);
        }
    }

    private void release(String key, String owner) {
        try {
            mongoTemplate.remove(new Query(Criteria.where("_id").is(key).and("owner").is(owner)), COLLECTION);
        } catch (RuntimeException ex) {
            // It expires on its own after LEASE.
            log.warn("Could not release lock {}: {}", key, ex.getMessage());
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ConflictException("Interrupted while waiting for another change to finish.");
        }
    }
}
