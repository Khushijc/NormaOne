package com.NormaOne.backend.config;

import java.nio.file.Path;
import java.time.Duration;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.NormaOne.backend.services.LocalNotificationAttachmentStorage;
import com.NormaOne.backend.services.NotificationAttachmentStorage;
import com.NormaOne.backend.services.S3NotificationAttachmentStorage;

import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * The attachment storage for normaone.attachments.storage: LOCAL (development) or S3 (production).
 * S3 needs a bucket name; without one the application refuses to start rather than fail at the
 * first upload. No credentials are configured here: the AWS default provider chain supplies them.
 */
@Configuration
public class AttachmentStorageConfig {

    @Bean
    public NotificationAttachmentStorage notificationAttachmentStorage(NormaOneProperties properties,
            @Value("${aws.region}") String awsRegion) {
        NormaOneProperties.Attachments attachments = properties.getAttachments();
        if (attachments.getStorage() == NormaOneProperties.StorageProvider.S3) {
            NormaOneProperties.S3 s3 = attachments.getS3();
            if (s3.getBucket() == null || s3.getBucket().isBlank()) {
                throw new IllegalStateException(
                        "normaone.attachments.s3.bucket is required when normaone.attachments.storage=S3.");
            }
            Region region = Region.of(s3.getRegion() == null || s3.getRegion().isBlank() ? awsRegion : s3.getRegion());
            return new S3NotificationAttachmentStorage(
                    S3Client.builder().region(region).build(),
                    S3Presigner.builder().region(region).build(),
                    s3.getBucket().trim(),
                    s3.getKeyPrefix(),
                    Duration.ofSeconds(Math.max(1, s3.getDownloadUrlSeconds())));
        }
        return new LocalNotificationAttachmentStorage(Path.of(attachments.getLocal().getDirectory()));
    }
}
