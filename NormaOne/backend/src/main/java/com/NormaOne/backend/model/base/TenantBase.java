package com.NormaOne.backend.model.base;

import java.time.Instant;

import org.springframework.data.mongodb.core.index.Indexed;

import com.NormaOne.backend.model.core.enums.RecordState;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

@Data
@EqualsAndHashCode(callSuper = true)
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
public abstract class TenantBase extends AuditedDocument {

    @Indexed
    @NotBlank
    private String tenantId;

    @NotNull
    @Builder.Default
    private RecordState recordState = RecordState.ACTIVE;

    private Instant archivedAt;

    private Instant deletedAt;

    private String deletedByDocsId;
}
