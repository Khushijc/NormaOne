package com.NormaOne.backend.exceptions;

/** 413 for an attachment larger than normaone.attachments.max-size. */
public class AttachmentTooLargeException extends RuntimeException {

    public AttachmentTooLargeException(String message) {
        super(message);
    }
}
