package com.NormaOne.backend.repositories;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.plans.PlanHistoryEntry;

/** Append-only (PlanHistoryEntry): insert, read, and delete only to undo a failed operation. */
public interface PlanHistoryRepository extends MongoRepository<PlanHistoryEntry, String> {
}
