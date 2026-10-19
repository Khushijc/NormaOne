package com.NormaOne.backend.services;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.regex.Pattern;

import org.springframework.core.io.FileSystemResource;

import com.NormaOne.backend.exceptions.ResourceNotFoundException;

/**
 * Attachments on this machine's disk, under normaone.attachments.local.directory. For development
 * only: the files are not shared between instances and are not backed up by anything here.
 *
 * A key is a relative path the server built from ids; it is still checked to stay inside the
 * directory. Files are written to a temporary name first and moved into place, so a half-written
 * file never has the final name.
 */
public class LocalNotificationAttachmentStorage implements NotificationAttachmentStorage {

    private static final Pattern SAFE_KEY = Pattern.compile("[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*");

    private final Path root;

    public LocalNotificationAttachmentStorage(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    @Override
    public String provider() {
        return "LOCAL";
    }

    @Override
    public void put(String key, byte[] content, String contentType) {
        Path target = resolve(key);
        try {
            Files.createDirectories(target.getParent());
            Path temporary = Files.createTempFile(target.getParent(), ".upload-", ".tmp");
            try {
                Files.write(temporary, content);
                try {
                    Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (AtomicMoveNotSupportedException notAtomic) {
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(temporary);
            }
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not write the attachment file.", ex);
        }
    }

    @Override
    public void delete(String key) {
        try {
            Files.deleteIfExists(resolve(key));
        } catch (IOException ex) {
            throw new UncheckedIOException("Could not delete the attachment file.", ex);
        }
    }

    @Override
    public Download download(String key, String fileName, String contentType) {
        Path file = resolve(key);
        if (!Files.isRegularFile(file)) {
            throw new ResourceNotFoundException("The attachment file is not available.");
        }
        return new Content(new FileSystemResource(file));
    }

    private Path resolve(String key) {
        if (key == null || !SAFE_KEY.matcher(key).matches()) {
            throw new IllegalStateException("Invalid attachment storage key.");
        }
        Path resolved = root.resolve(key).normalize();
        if (!resolved.startsWith(root)) {
            throw new IllegalStateException("Invalid attachment storage key.");
        }
        return resolved;
    }
}
