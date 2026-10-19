package com.NormaOne.backend.exceptions;

public class UserAlreadyOnboardedException extends RuntimeException {

    public UserAlreadyOnboardedException(String message) {
        super(message);
    }
}
