package com.NormaOne.backend.exceptions;

public class UserAlreadyExistsException extends RuntimeException {

    private final boolean confirmed;

    public UserAlreadyExistsException(String message, boolean confirmed) {
        super(message);
        this.confirmed = confirmed;
    }

    public boolean isConfirmed() {
        return confirmed;
    }
}
