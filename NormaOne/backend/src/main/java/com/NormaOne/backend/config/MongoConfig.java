package com.NormaOne.backend.config;

import java.util.Optional;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.mongodb.MongoDatabaseFactory;
import org.springframework.data.mongodb.MongoTransactionManager;
import org.springframework.data.mongodb.config.EnableMongoAuditing;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import com.NormaOne.backend.security.CognitoJwtAuthenticationConverter.AuthenticatedActor;

@Configuration
@EnableMongoAuditing(auditorAwareRef = "auditorProvider")
public class MongoConfig {

    /**
     * Fills createdByDocsId / updatedByDocsId: the caller's user document id; before onboarding
     * (no user document yet) the Cognito sub; "system" for startup tasks.
     */
    @Bean
    public AuditorAware<String> auditorProvider() {
        return () -> {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth instanceof JwtAuthenticationToken jwtAuth) {
                if (jwtAuth.getDetails() instanceof AuthenticatedActor actor && actor.userId() != null) {
                    return Optional.of(actor.userId());
                }
                return Optional.ofNullable(jwtAuth.getToken().getSubject());
            }
            return Optional.of("system");
        };
    }

    /**
     * Used only when the connected deployment supports transactions (replica set or sharded
     * cluster); see MongoTopology. A standalone server uses compensation instead.
     */
    @Bean
    public MongoTransactionManager mongoTransactionManager(MongoDatabaseFactory factory) {
        return new MongoTransactionManager(factory);
    }
}
