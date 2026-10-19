package com.NormaOne.backend.exceptions;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;

import software.amazon.awssdk.services.cognitoidentityprovider.model.CodeMismatchException;
import tools.jackson.databind.exc.InvalidFormatException;
import tools.jackson.databind.exc.MismatchedInputException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.CognitoIdentityProviderException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.ExpiredCodeException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InvalidPasswordException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.InvalidParameterException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.NotAuthorizedException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.TooManyFailedAttemptsException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.TooManyRequestsException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserNotConfirmedException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UserNotFoundException;
import software.amazon.awssdk.services.cognitoidentityprovider.model.UsernameExistsException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(UserAlreadyExistsException.class)
    public ResponseEntity<ErrorResponse> handleUserAlreadyExists(
            UserAlreadyExistsException ex, WebRequest request) {
        log.warn("User already exists conflict: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                ex.getMessage(),
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
    }

    @ExceptionHandler(DuplicateSubdomainException.class)
    public ResponseEntity<ErrorResponse> handleDuplicateSubdomain(
            DuplicateSubdomainException ex, WebRequest request) {
        log.warn("Duplicate subdomain: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                ex.getMessage(),
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
    }

    @ExceptionHandler(UserAlreadyOnboardedException.class)
    public ResponseEntity<ErrorResponse> handleUserAlreadyOnboarded(
            UserAlreadyOnboardedException ex, WebRequest request) {
        log.warn("User already onboarded: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                ex.getMessage(),
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
    }

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(ResourceNotFoundException ex, WebRequest request) {
        return build(HttpStatus.NOT_FOUND, ex.getMessage(), request);
    }

    @ExceptionHandler(ForbiddenOperationException.class)
    public ResponseEntity<ErrorResponse> handleForbiddenOperation(ForbiddenOperationException ex, WebRequest request) {
        log.warn("Forbidden operation at {}: {}", extractPath(request), ex.getMessage());
        return build(HttpStatus.FORBIDDEN, ex.getMessage(), request);
    }

    @ExceptionHandler(InvitationDeliveryException.class)
    public ResponseEntity<ErrorResponse> handleInvitationDelivery(InvitationDeliveryException ex, WebRequest request) {
        // The cause is Cognito's own exception: its type is logged, never the request that carried a name and email.
        log.error("Invitation not delivered at {}: {} ({})", extractPath(request), ex.getMessage(),
                ex.getCause() != null ? ex.getCause().getClass().getSimpleName() : "no cause");
        return build(HttpStatus.BAD_GATEWAY, ex.getMessage(), request);
    }

    @ExceptionHandler(IdentityProviderException.class)
    public ResponseEntity<ErrorResponse> handleIdentityProvider(IdentityProviderException ex, WebRequest request) {
        // Cognito's exception type only, never the account's email.
        log.error("Identity provider failed at {}: {} ({})", extractPath(request), ex.getMessage(),
                ex.getCause() != null ? ex.getCause().getClass().getSimpleName() : "no cause");
        return build(HttpStatus.BAD_GATEWAY, ex.getMessage(), request);
    }

    @ExceptionHandler(AttachmentStorageException.class)
    public ResponseEntity<ErrorResponse> handleAttachmentStorage(AttachmentStorageException ex, WebRequest request) {
        // The storage's own error type only: never the file name or its content.
        log.error("Attachment not stored at {}: {} ({})", extractPath(request), ex.getMessage(),
                ex.getCause() != null ? ex.getCause().getClass().getSimpleName() : "no cause");
        return build(HttpStatus.BAD_GATEWAY, ex.getMessage(), request);
    }

    @ExceptionHandler(AttachmentTooLargeException.class)
    public ResponseEntity<ErrorResponse> handleAttachmentTooLarge(AttachmentTooLargeException ex, WebRequest request) {
        return build(HttpStatus.CONTENT_TOO_LARGE, ex.getMessage(), request);
    }

    /** The servlet container's own multipart limit (spring.servlet.multipart.max-file-size / max-request-size). */
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> handleMaxUploadSize(Exception ex, WebRequest request) {
        return build(HttpStatus.CONTENT_TOO_LARGE, "The upload is larger than the server accepts.", request);
    }

    @ExceptionHandler({
            org.springframework.web.multipart.support.MissingServletRequestPartException.class,
            org.springframework.web.multipart.MultipartException.class
    })
    public ResponseEntity<ErrorResponse> handleBadMultipart(Exception ex, WebRequest request) {
        log.warn("Bad multipart request at {}: {}", extractPath(request), ex.getMessage());
        String message = ex instanceof org.springframework.web.multipart.support.MissingServletRequestPartException missing
                ? "Missing request part '" + missing.getRequestPartName() + "'."
                : "Malformed multipart request.";
        return build(HttpStatus.BAD_REQUEST, message, request);
    }

    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleUnsupportedMediaType(Exception ex, WebRequest request) {
        return build(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported content type for this endpoint.", request);
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ErrorResponse> handleConflict(ConflictException ex, WebRequest request) {
        log.warn("Conflict at {}: {}", extractPath(request), ex.getMessage());
        return build(HttpStatus.CONFLICT, ex.getMessage(), request);
    }

    @ExceptionHandler(PackageUnavailableException.class)
    public ResponseEntity<ErrorResponse> handlePackageUnavailable(PackageUnavailableException ex, WebRequest request) {
        log.error("Default package unavailable at {}: {}", extractPath(request), ex.getMessage());
        return build(HttpStatus.SERVICE_UNAVAILABLE, ex.getMessage(), request);
    }

    @ExceptionHandler(org.springframework.dao.OptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLock(
            org.springframework.dao.OptimisticLockingFailureException ex, WebRequest request) {
        log.warn("Concurrent modification at {}: {}", extractPath(request), ex.getMessage());
        return build(HttpStatus.CONFLICT, "The record was changed by another request. Reload it and try again.", request);
    }

    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNoResource(
            org.springframework.web.servlet.resource.NoResourceFoundException ex, WebRequest request) {
        return build(HttpStatus.NOT_FOUND, "Resource not found.", request);
    }

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethodNotSupported(
            org.springframework.web.HttpRequestMethodNotSupportedException ex, WebRequest request) {
        return build(HttpStatus.METHOD_NOT_ALLOWED, "HTTP method not supported for this endpoint.", request);
    }

    @ExceptionHandler({
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
            org.springframework.web.bind.MissingServletRequestParameterException.class,
            jakarta.validation.ConstraintViolationException.class
    })
    public ResponseEntity<ErrorResponse> handleBadParameter(Exception ex, WebRequest request) {
        log.warn("Invalid request parameter at {}: {}", extractPath(request), ex.getMessage());
        return build(HttpStatus.BAD_REQUEST, "Invalid request parameter.", request);
    }

    /**
     * Validation of a method that has constraints on a path variable or parameter as well as a
     * {@code @Valid} body. Spring then validates the whole method and raises this instead of
     * MethodArgumentNotValidException, so the body's field errors are collected here — otherwise a
     * blank name on such an endpoint answered a bare "Invalid request parameter." with no field.
     */
    @ExceptionHandler(org.springframework.web.method.annotation.HandlerMethodValidationException.class)
    public ResponseEntity<ErrorResponse> handleMethodValidation(
            org.springframework.web.method.annotation.HandlerMethodValidationException ex, WebRequest request) {
        Map<String, String> fieldErrors = new java.util.LinkedHashMap<>();
        for (org.springframework.validation.method.ParameterErrors errors : ex.getBeanResults()) {
            for (FieldError fieldError : errors.getFieldErrors()) {
                fieldErrors.putIfAbsent(fieldError.getField(), fieldError.getDefaultMessage());
            }
        }
        for (org.springframework.validation.method.ParameterValidationResult result : ex.getValueResults()) {
            String name = result.getMethodParameter().getParameterName();
            result.getResolvableErrors().stream().findFirst().ifPresent(
                    error -> fieldErrors.putIfAbsent(name != null ? name : "parameter", error.getDefaultMessage()));
        }
        log.warn("Validation failed on {}: {}", extractPath(request), fieldErrors);
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Validation failed for request parameters.",
                extractPath(request),
                fieldErrors.isEmpty() ? null : fieldErrors
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    private ResponseEntity<ErrorResponse> build(HttpStatus status, String message, WebRequest request) {
        ErrorResponse error = new ErrorResponse(status.value(), status.getReasonPhrase(), message, extractPath(request));
        return ResponseEntity.status(status).body(error);
    }

    @ExceptionHandler(org.springframework.dao.DuplicateKeyException.class)
    public ResponseEntity<ErrorResponse> handleMongoDuplicateKey(
            org.springframework.dao.DuplicateKeyException ex, WebRequest request) {
        log.warn("MongoDB duplicate key conflict: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                "A resource with this identifier or unique attribute already exists.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
    }

    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDenied(
            org.springframework.security.access.AccessDeniedException ex, WebRequest request) {
        log.warn("Access denied: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.FORBIDDEN.value(),
                HttpStatus.FORBIDDEN.getReasonPhrase(),
                "Access denied.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(error);
    }

    @ExceptionHandler(UsernameExistsException.class)
    public ResponseEntity<ErrorResponse> handleCognitoUsernameExists(
            UsernameExistsException ex, WebRequest request) {
        log.warn("Cognito UsernameExistsException: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.CONFLICT.value(),
                HttpStatus.CONFLICT.getReasonPhrase(),
                "An account with this email already exists. If your account is not verified, please verify with your code or request a new one.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
    }

    @ExceptionHandler(CodeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleCodeMismatch(
            CodeMismatchException ex, WebRequest request) {
        log.warn("Invalid verification code: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Invalid verification code. Please check the code and try again.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(ExpiredCodeException.class)
    public ResponseEntity<ErrorResponse> handleExpiredCode(
            ExpiredCodeException ex, WebRequest request) {
        log.warn("Expired verification code: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "The verification code has expired. Please request a new verification code.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(UserNotConfirmedException.class)
    public ResponseEntity<ErrorResponse> handleUserNotConfirmed(
            UserNotConfirmedException ex, WebRequest request) {
        log.warn("User unconfirmed: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.FORBIDDEN.value(),
                HttpStatus.FORBIDDEN.getReasonPhrase(),
                "User account is not verified. Please verify your email before logging in.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(error);
    }

    @ExceptionHandler(NotAuthorizedException.class)
    public ResponseEntity<ErrorResponse> handleNotAuthorized(
            NotAuthorizedException ex, WebRequest request) {
        String msg = ex.awsErrorDetails() != null ? ex.awsErrorDetails().errorMessage() : ex.getMessage();
        log.warn("Cognito NotAuthorizedException: {}", msg);

        if (msg != null && (msg.contains("CONFIRMED") || msg.contains("confirmed"))) {
            ErrorResponse error = new ErrorResponse(
                    HttpStatus.CONFLICT.value(),
                    HttpStatus.CONFLICT.getReasonPhrase(),
                    "Account is already verified. Please log in.",
                    extractPath(request)
            );
            return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
        }

        // An invitation's temporary password is valid for the pool's configured number of days. After
        // that Cognito refuses it with this message; only a resent invitation issues a new one.
        if (msg != null && msg.toLowerCase(java.util.Locale.ROOT).contains("temporary password has expired")) {
            return build(HttpStatus.UNAUTHORIZED,
                    "The temporary password has expired. Ask your administrator to resend the invitation.", request);
        }

        ErrorResponse error = new ErrorResponse(
                HttpStatus.UNAUTHORIZED.value(),
                HttpStatus.UNAUTHORIZED.getReasonPhrase(),
                "Invalid credentials or unauthorized operation.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
    }

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(
            UserNotFoundException ex, WebRequest request) {
        log.warn("Cognito UserNotFoundException: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.NOT_FOUND.value(),
                HttpStatus.NOT_FOUND.getReasonPhrase(),
                "User not found with the provided email address.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    @ExceptionHandler(InvalidPasswordException.class)
    public ResponseEntity<ErrorResponse> handleInvalidPassword(
            InvalidPasswordException ex, WebRequest request) {
        String msg = ex.awsErrorDetails() != null ? ex.awsErrorDetails().errorMessage() : "Password does not meet complexity requirements.";
        log.warn("Cognito InvalidPasswordException: {}", msg);
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                msg,
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(InvalidParameterException.class)
    public ResponseEntity<ErrorResponse> handleInvalidParameter(
            InvalidParameterException ex, WebRequest request) {
        String msg = ex.awsErrorDetails() != null ? ex.awsErrorDetails().errorMessage() : ex.getMessage();
        log.warn("Cognito InvalidParameterException: {}", msg);

        if (msg != null && (msg.contains("already confirmed") || msg.contains("CONFIRMED"))) {
            ErrorResponse error = new ErrorResponse(
                    HttpStatus.CONFLICT.value(),
                    HttpStatus.CONFLICT.getReasonPhrase(),
                    "User account is already confirmed. Please log in.",
                    extractPath(request)
            );
            return ResponseEntity.status(HttpStatus.CONFLICT).body(error);
        }

        if (msg != null && msg.contains("USER_PASSWORD_AUTH")) {
            ErrorResponse error = new ErrorResponse(
                    HttpStatus.BAD_REQUEST.value(),
                    HttpStatus.BAD_REQUEST.getReasonPhrase(),
                    "Password authentication flow (USER_PASSWORD_AUTH) is not enabled on the Cognito app client. Please enable it in Cognito settings.",
                    extractPath(request)
            );
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
        }

        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                msg != null ? msg : "Invalid parameter provided.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler({TooManyRequestsException.class, TooManyFailedAttemptsException.class})
    public ResponseEntity<ErrorResponse> handleRateLimits(
            CognitoIdentityProviderException ex, WebRequest request) {
        log.warn("Cognito rate limit encountered: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.TOO_MANY_REQUESTS.value(),
                HttpStatus.TOO_MANY_REQUESTS.getReasonPhrase(),
                "Too many attempts. Please wait a few minutes before trying again.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
    }

    @ExceptionHandler(CognitoIdentityProviderException.class)
    public ResponseEntity<ErrorResponse> handleGenericCognitoException(
            CognitoIdentityProviderException ex, WebRequest request) {
        String msg = ex.awsErrorDetails() != null ? ex.awsErrorDetails().errorMessage() : ex.getMessage();
        log.error("Unhandled CognitoIdentityProviderException: ", ex);
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                msg != null ? msg : "Authentication service error.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException ex, WebRequest request) {
        Map<String, String> fieldErrors = new HashMap<>();
        for (FieldError fieldError : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.put(fieldError.getField(), fieldError.getDefaultMessage());
        }

        log.warn("Validation failed on {}: {}", extractPath(request), fieldErrors);
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                "Validation failed for request parameters.",
                extractPath(request),
                fieldErrors
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleNotReadable(
            HttpMessageNotReadableException ex, WebRequest request) {
        log.warn("Malformed JSON payload: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                notReadableMessage(ex),
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    /** Names the offending field, and the accepted values for an enum, when the body is valid JSON. */
    private static String notReadableMessage(HttpMessageNotReadableException ex) {
        if (ex.getCause() instanceof MismatchedInputException mismatch && !mismatch.getPath().isEmpty()) {
            String field = mismatch.getPath().stream()
                    .map(r -> r.getPropertyName() != null ? r.getPropertyName() : "[" + r.getIndex() + "]")
                    .collect(Collectors.joining("."));
            Class<?> target = mismatch.getTargetType();
            if (target != null && target.isEnum()) {
                String allowed = Arrays.stream(target.getEnumConstants()).map(Object::toString).collect(Collectors.joining(", "));
                Object value = mismatch instanceof InvalidFormatException invalid ? invalid.getValue() : null;
                return "Invalid value " + (value != null ? "'" + value + "' " : "") + "for field '" + field
                        + "'. Allowed values: " + allowed + ".";
            }
            return "Invalid value for field '" + field + "'.";
        }
        return "Malformed JSON request body.";
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(
            IllegalArgumentException ex, WebRequest request) {
        log.warn("Illegal argument: {}", ex.getMessage());
        ErrorResponse error = new ErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                HttpStatus.BAD_REQUEST.getReasonPhrase(),
                ex.getMessage(),
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGlobalException(
            Exception ex, WebRequest request) {
        log.error("Unhandled server exception at {}: ", extractPath(request), ex);
        ErrorResponse error = new ErrorResponse(
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
                "An unexpected internal error occurred. Please try again later.",
                extractPath(request)
        );
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }

    private String extractPath(WebRequest request) {
        if (request instanceof ServletWebRequest servletWebRequest) {
            return servletWebRequest.getRequest().getRequestURI();
        }
        return request.getDescription(false).replace("uri=", "");
    }
}
