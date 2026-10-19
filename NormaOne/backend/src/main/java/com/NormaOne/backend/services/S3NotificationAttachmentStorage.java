package com.NormaOne.backend.services;

import java.net.URISyntaxException;
import java.time.Duration;

import org.springframework.http.ContentDisposition;

import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.ServerSideEncryption;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

/**
 * Attachments in a private Amazon S3 bucket (production).
 *
 * Objects are written with server-side encryption and are never public: a download is a presigned
 * GET URL that lives normaone.attachments.s3.download-url-seconds (60 by default) and makes the
 * browser save the file under its original name instead of displaying it. Credentials come from
 * the default AWS provider chain (environment, profile or instance role), as for Cognito.
 */
public class S3NotificationAttachmentStorage implements NotificationAttachmentStorage, AutoCloseable {

    private final S3Client client;
    private final S3Presigner presigner;
    private final String bucket;
    private final String keyPrefix;
    private final Duration downloadUrlLifetime;

    public S3NotificationAttachmentStorage(S3Client client, S3Presigner presigner, String bucket, String keyPrefix,
            Duration downloadUrlLifetime) {
        this.client = client;
        this.presigner = presigner;
        this.bucket = bucket;
        this.keyPrefix = keyPrefix == null ? "" : keyPrefix;
        this.downloadUrlLifetime = downloadUrlLifetime;
    }

    @Override
    public String provider() {
        return "S3";
    }

    @Override
    public void put(String key, byte[] content, String contentType) {
        client.putObject(PutObjectRequest.builder()
                        .bucket(bucket)
                        .key(keyPrefix + key)
                        .contentType(contentType)
                        .contentLength((long) content.length)
                        .serverSideEncryption(ServerSideEncryption.AES256)
                        .build(),
                RequestBody.fromBytes(content));
    }

    @Override
    public void delete(String key) {
        client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(keyPrefix + key).build());
    }

    @Override
    public Download download(String key, String fileName, String contentType) {
        GetObjectRequest get = GetObjectRequest.builder()
                .bucket(bucket)
                .key(keyPrefix + key)
                .responseContentType(contentType)
                .responseContentDisposition(ContentDisposition.attachment()
                        .filename(fileName, java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .build();
        try {
            return new Redirect(presigner.presignGetObject(GetObjectPresignRequest.builder()
                    .signatureDuration(downloadUrlLifetime)
                    .getObjectRequest(get)
                    .build()).url().toURI());
        } catch (URISyntaxException ex) {
            throw new IllegalStateException("The presigned URL is not a valid URI.", ex);
        }
    }

    @Override
    public void close() {
        presigner.close();
        client.close();
    }
}
