package com.NormaOne.backend.services;

import java.util.List;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.config.NormaOneProperties;

/**
 * Hands an email to the configured SMTP server. Configured means both: Spring Boot built a
 * JavaMailSender (spring.mail.host is set) and normaone.email.from names a sender. Without them
 * {@link #configured()} is false and EmailOutboxService keeps emails PENDING instead of calling this.
 */
@Component
public class EmailSender {

    private final ObjectProvider<JavaMailSender> mailSender;
    private final NormaOneProperties properties;

    public EmailSender(ObjectProvider<JavaMailSender> mailSender, NormaOneProperties properties) {
        this.mailSender = mailSender;
        this.properties = properties;
    }

    public boolean configured() {
        String from = properties.getEmail().getFrom();
        return from != null && !from.isBlank() && mailSender.getIfAvailable() != null;
    }

    /** Sends a plain-text email; throws on any delivery failure. */
    public void send(List<String> to, String subject, String body) {
        JavaMailSender sender = mailSender.getIfAvailable();
        if (sender == null || !configured()) {
            throw new IllegalStateException("Email delivery is not configured.");
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(properties.getEmail().getFrom().trim());
        message.setTo(to.toArray(String[]::new));
        message.setSubject(subject);
        message.setText(body);
        sender.send(message);
    }
}
