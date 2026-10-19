package com.NormaOne.backend.security;

import java.util.Collection;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * Builds the authentication for a validated Cognito JWT. The principal stays the {@link Jwt}
 * (so {@code @AuthenticationPrincipal Jwt} keeps working); authorities come from the persisted
 * user record via {@link CurrentUserResolver}, and the details carry the resolved actor ids
 * for auditing.
 */
@Component
public class CognitoJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    private final CurrentUserResolver resolver;

    public CognitoJwtAuthenticationConverter(CurrentUserResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        CurrentUser current = resolver.resolve(jwt);
        JwtAuthenticationToken token = new JwtAuthenticationToken(jwt, resolver.authorities(current), jwt.getSubject());
        token.setDetails(new AuthenticatedActor(current.userId(), current.tenantId(),
                current.role() != null ? current.role().name() : null));
        return token;
    }

    /** Authorities only (used by tests with spring-security-test's jwt() post-processor). */
    public Converter<Jwt, Collection<GrantedAuthority>> authoritiesConverter() {
        return jwt -> resolver.authorities(resolver.resolve(jwt));
    }

    /** Resolved ids of the caller, attached as authentication details. */
    public record AuthenticatedActor(String userId, String tenantId, String role) {}
}
