package com.NormaOne.backend.repositories;

import java.util.Optional;

import org.springframework.data.mongodb.repository.MongoRepository;

import com.NormaOne.backend.model.notification.OutboundEmail;

public interface OutboundEmailRepository extends MongoRepository<OutboundEmail, String> {

    Optional<OutboundEmail> findFirstByReferenceTypeAndReferenceIdOrderByCreatedAtDesc(String referenceType, String referenceId);
}
