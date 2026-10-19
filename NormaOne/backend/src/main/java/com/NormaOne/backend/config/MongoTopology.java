package com.NormaOne.backend.config;

import org.bson.Document;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

/**
 * Detects (once) whether the connected MongoDB deployment supports multi-document transactions:
 * a replica set member or a mongos router does; a standalone server does not.
 */
@Component
public class MongoTopology {

    private static final Logger log = LoggerFactory.getLogger(MongoTopology.class);

    private final MongoTemplate mongoTemplate;
    private volatile Boolean transactions;

    public MongoTopology(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public boolean supportsTransactions() {
        Boolean known = transactions;
        if (known != null) {
            return known;
        }
        boolean supported;
        try {
            Document hello = mongoTemplate.executeCommand(new Document("hello", 1));
            supported = hello.get("setName") != null || "isdbgrid".equals(hello.get("msg"));
        } catch (RuntimeException ex) {
            log.warn("Could not determine MongoDB topology; using compensation instead of transactions: {}", ex.getMessage());
            supported = false;
        }
        log.info("MongoDB transactions {} for multi-document writes.",
                supported ? "are available and will be used" : "are NOT available (standalone server); compensation is used");
        transactions = supported;
        return supported;
    }
}
