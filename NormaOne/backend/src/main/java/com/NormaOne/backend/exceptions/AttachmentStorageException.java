package com.NormaOne.backend.exceptions;

/**
 * The attachment storage (local disk or S3) failed to store a file. Nothing was saved: no
 * notification refers to a file that is not there. Answered with 502, like a failed invitation:
 * the request was valid, the storage failed it.
 */
public class AttachmentStorageException extends RuntimeException {

    public AttachmentStorageException(String message, Throwable cause) {
        super(message, cause);
    }
}
