package com.NormaOne.backend.config;

import java.util.List;
import java.util.Set;

import org.springframework.context.annotation.Configuration;
import org.springframework.core.ResolvableType;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverters;
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.NormaOne.backend.dto.notification.CreateNotificationRequest;

import tools.jackson.databind.json.JsonMapper;

/**
 * Reads the JSON part of a multipart request when that part carries no Content-Type of its own.
 *
 * WHY. Browsers send {@code formData.append("notification", JSON.stringify(body))} as a plain form
 * field with no Content-Type, and so do Postman form-data text fields and {@code curl -F}. Spring
 * then treats the part as application/octet-stream, finds no converter for the request type, and the
 * request failed with 415 although it was well formed. Clients that set application/json on the part
 * (the API tester) were unaffected.
 *
 * HOW NARROW. This converter only reads (never writes), only application/octet-stream (which is what
 * "no Content-Type" becomes), and only the request types listed in {@link #JSON_PARTS} — the JSON
 * parts of the multipart endpoints. It uses the application's own JsonMapper, so the part is parsed
 * exactly like a JSON body, and @Valid still applies. A part sent with an explicit content type that
 * is not JSON is still refused with 415.
 */
@Configuration
public class MultipartJsonPartConfig implements WebMvcConfigurer {

    /** Request types that multipart endpoints receive as a JSON part. */
    static final Set<Class<?>> JSON_PARTS = Set.of(CreateNotificationRequest.class);

    private final JsonMapper jsonMapper;

    public MultipartJsonPartConfig(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    @Override
    public void configureMessageConverters(HttpMessageConverters.ServerBuilder builder) {
        builder.addCustomConverter(new UntypedJsonPartConverter(jsonMapper));
    }

    static final class UntypedJsonPartConverter extends JacksonJsonHttpMessageConverter {

        UntypedJsonPartConverter(JsonMapper mapper) {
            super(mapper);
            setSupportedMediaTypes(List.of(MediaType.APPLICATION_OCTET_STREAM));
        }

        @Override
        public boolean canRead(ResolvableType type, MediaType mediaType) {
            return JSON_PARTS.contains(type.toClass()) && super.canRead(type, mediaType);
        }

        @Override
        public boolean canRead(Class<?> clazz, MediaType mediaType) {
            return JSON_PARTS.contains(clazz) && super.canRead(clazz, mediaType);
        }

        @Override
        public boolean canWrite(ResolvableType type, Class<?> clazz, MediaType mediaType) {
            return false;
        }

        @Override
        public boolean canWrite(Class<?> clazz, MediaType mediaType) {
            return false;
        }
    }
}
