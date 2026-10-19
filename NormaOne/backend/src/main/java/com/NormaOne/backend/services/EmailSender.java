package com.NormaOne.backend.services;

import java.util.List;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import com.NormaOne.backend.config.NormaOneProperties;
import com.NormaOne.backend.config.NormaOneProperties.Email.Provider;

import jakarta.annotation.PreDestroy;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sesv2.SesV2Client;
import software.amazon.awssdk.services.sesv2.model.SendEmailRequest;

/**
 * Hands an email to the configured provider:
 * <ul>
 *   <li>SES (default): Amazon SES v2 SendEmail, with the AWS default credentials — the same ones
 *       Cognito uses — in normaone.email.ses-region or aws.region. Needs ses:SendEmail, and the
 *       sender (and, while the SES account is in the sandbox, every recipient) verified in SES.</li>
 *   <li>SMTP: the JavaMailSender Spring Boot builds from spring.mail.host and friends.</li>
 * </ul>
 * {@link #configured()} is false without a sender address (or, for SMTP, without a mail server), and
 * EmailOutboxService then keeps emails PENDING instead of calling this.
 */
@Component
public class EmailSender {

    private final ObjectProvider<JavaMailSender> mailSender;
    private final NormaOneProperties properties;
    private final String awsRegion;
    private volatile SesV2Client ses;

    public EmailSender(ObjectProvider<JavaMailSender> mailSender, NormaOneProperties properties,
            @Value("${aws.region:}") String awsRegion) {
        this.mailSender = mailSender;
        this.properties = properties;
        this.awsRegion = awsRegion;
    }

    public boolean configured() {
        String from = properties.getEmail().getFrom();
        if (from == null || from.isBlank()) {
            return false;
        }
        return properties.getEmail().getProvider() == Provider.SES ? !region().isBlank() : mailSender.getIfAvailable() != null;
    }

    /** Sends a plain-text email; throws on any delivery failure. */
    public void send(List<String> to, String subject, String body) {
        if (!configured()) {
            throw new IllegalStateException("Email delivery is not configured.");
        }
        String from = properties.getEmail().getFrom().trim();
        if (properties.getEmail().getProvider() == Provider.SES) {
            ses().sendEmail(SendEmailRequest.builder()
                    .fromEmailAddress(from)
                    .destination(d -> d.toAddresses(to))
                    .content(c -> c.simple(m -> m
                            .subject(s -> s.data(subject).charset("UTF-8"))
                            .body(b -> b.text(t -> t.data(body).charset("UTF-8")))))
                    .build());
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(to.toArray(String[]::new));
        message.setSubject(subject);
        message.setText(body);
        mailSender.getObject().send(message);
    }

    private String region() {
        String configured = properties.getEmail().getSesRegion();
        return configured != null && !configured.isBlank() ? configured.trim() : awsRegion == null ? "" : awsRegion.trim();
    }

    /** Built on first use, so an application that never emails never creates an SES client. */
    private SesV2Client ses() {
        SesV2Client client = ses;
        if (client == null) {
            synchronized (this) {
                if (ses == null) {
                    ses = SesV2Client.builder().region(Region.of(region())).build();
                }
                client = ses;
            }
        }
        return client;
    }

    @PreDestroy
    void close() {
        if (ses != null) {
            ses.close();
        }
    }
}
