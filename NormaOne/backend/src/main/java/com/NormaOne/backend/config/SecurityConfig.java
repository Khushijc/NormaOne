package com.NormaOne.backend.config;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.SupplierJwtDecoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.NormaOne.backend.security.CognitoJwtAuthenticationConverter;
import com.NormaOne.backend.security.CognitoTokenValidator;
import com.NormaOne.backend.security.CookieBearerTokenResolver;
import com.NormaOne.backend.security.CsrfHeaderFilter;
import com.NormaOne.backend.security.JsonSecurityErrorHandlers;

/**
 * HTTP security. Authorization is also re-checked in the services (CurrentUserService) and with
 * method security on the admin controllers.
 *
 * - /api/auth/** is public (register, verify-email, resend-code, login).
 * - /api/onboarding/** and /api/users/me need only a valid token: they are how a user who has not
 *   completed onboarding finishes it and learns their status.
 * - /api/super-admin/** needs SUPER_ADMIN and /api/tenant/** needs ADMIN.
 * - Every other API needs an active, onboarded account (any application role).
 *
 * The token comes from the Authorization header or, for browsers, the HttpOnly session cookie
 * (CookieBearerTokenResolver). Cookie sessions are protected against CSRF by SameSite=Strict and
 * CsrfHeaderFilter; Spring's own CSRF token stays off because a request with an Authorization header
 * cannot be forged by another site and one with a cookie is covered by that filter. CORS is off unless
 * normaone.auth.cors-allowed-origins lists origins, which then may call with credentials.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            CognitoJwtAuthenticationConverter jwtAuthenticationConverter,
            JsonSecurityErrorHandlers errorHandlers,
            NormaOneProperties properties) throws Exception {

        List<String> origins = properties.getAuth().getCorsAllowedOrigins();
        if (origins != null && !origins.isEmpty()) {
            http.cors(cors -> cors.configurationSource(corsSource(origins)));
        }

        http
                .csrf(csrf -> csrf.disable())
                .addFilterBefore(new CsrfHeaderFilter(), BearerTokenAuthenticationFilter.class)
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(
                                "/api/auth/**",
                                "/error")
                        .permitAll()
                        .requestMatchers("/api/onboarding/**").authenticated()
                        .requestMatchers("/api/users/me").authenticated()
                        .requestMatchers("/api/super-admin/**").hasRole("SUPER_ADMIN")
                        .requestMatchers("/api/tenant/**").hasRole("ADMIN")
                        .anyRequest().hasAnyRole("SUPER_ADMIN", "ADMIN", "USER"))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(errorHandlers)
                        .accessDeniedHandler(errorHandlers))
                .oauth2ResourceServer(oauth2 -> oauth2
                        .bearerTokenResolver(new CookieBearerTokenResolver())
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter))
                        .authenticationEntryPoint(errorHandlers)
                        .accessDeniedHandler(errorHandlers));

        return http.build();
    }

    /** Exactly the configured origins, with credentials, and the headers the browser client sends. */
    private static CorsConfigurationSource corsSource(List<String> origins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(origins);
        config.setAllowCredentials(true);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
        config.setAllowedHeaders(List.of("Content-Type", "Authorization", CsrfHeaderFilter.HEADER));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    /**
     * Cognito JWT decoder: signature and issuer as before, plus the app-client check.
     * The signing keys are fetched lazily on first use, so startup does not need network access.
     */
    @Bean
    public JwtDecoder jwtDecoder(
            @Value("${spring.security.oauth2.resourceserver.jwt.issuer-uri}") String issuerUri,
            @Value("${aws.cognito.client-id}") String clientId) {
        return new SupplierJwtDecoder(() -> {
            NimbusJwtDecoder decoder = NimbusJwtDecoder.withIssuerLocation(issuerUri).build();
            decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                    JwtValidators.createDefaultWithIssuer(issuerUri),
                    new CognitoTokenValidator(clientId)));
            return decoder;
        });
    }
}
