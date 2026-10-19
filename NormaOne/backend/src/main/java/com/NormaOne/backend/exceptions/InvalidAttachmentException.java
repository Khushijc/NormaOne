package com.NormaOne.backend.exceptions;

/**
 * 400 for an attachment that is not accepted: empty, a type that is not allowed, content that is
 * none of the accepted types, or a file name whose extension does not match the content. A kind of
 * IllegalArgumentException, so the existing 400 handler answers it with its message.
 */
public class InvalidAttachmentException extends IllegalArgumentException {

    public InvalidAttachmentException(String message) {
        super(message);
    }
}
