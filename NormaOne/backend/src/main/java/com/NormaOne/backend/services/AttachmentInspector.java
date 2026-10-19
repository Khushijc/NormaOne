package com.NormaOne.backend.services;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collection;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

import com.NormaOne.backend.exceptions.AttachmentTooLargeException;
import com.NormaOne.backend.exceptions.InvalidAttachmentException;
import com.NormaOne.backend.model.notification.enums.AttachmentType;

/**
 * Decides what an uploaded file is from its bytes, never from its name or the MIME type the client
 * sent, and refuses anything else.
 *
 * <ul>
 *   <li>PDF, PNG and JPEG by their signatures.</li>
 *   <li>DOCX and XLSX are ZIP packages: the ZIP's central directory (read from the end of the file,
 *       without decompressing anything, so a ZIP bomb costs nothing) must list
 *       {@code [Content_Types].xml} and {@code word/document.xml} or {@code xl/workbook.xml}.</li>
 * </ul>
 * The file name must end in an extension of the detected type, so a name never claims a different
 * type than the content. This is a content check, not a malware scan.
 */
public final class AttachmentInspector {

    /** What an accepted file turned out to be. */
    public record Inspected(AttachmentType type, String fileName, String checksumSha256) {}

    private static final byte[] PDF = "%PDF-".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    private static final byte[] ZIP = {'P', 'K', 0x03, 0x04};
    private static final int EOCD_SIGNATURE = 0x06054b50;
    private static final int CENTRAL_HEADER_SIGNATURE = 0x02014b50;
    private static final int MAX_ZIP_ENTRIES = 10_000;
    private static final int MAX_FILE_NAME = 200;

    private AttachmentInspector() {
    }

    public static Inspected inspect(String originalName, byte[] content, long maxBytes, Collection<AttachmentType> allowed) {
        if (content == null || content.length == 0) {
            throw new InvalidAttachmentException("The attachment is empty.");
        }
        if (content.length > maxBytes) {
            throw new AttachmentTooLargeException("The attachment is larger than the maximum of " + describe(maxBytes) + ".");
        }
        String accepted = allowed.stream().map(Enum::name).sorted().collect(Collectors.joining(", "));
        AttachmentType type = detect(content);
        if (type == null) {
            throw new InvalidAttachmentException("The attachment's content is not an accepted file type (" + accepted + ").");
        }
        if (!allowed.contains(type)) {
            throw new InvalidAttachmentException(type.name() + " files are not accepted. Accepted: " + accepted + ".");
        }
        String fileName = cleanFileName(originalName, type);
        String extension = extensionOf(fileName);
        if (!type.extensions().contains(extension)) {
            throw new InvalidAttachmentException("The file name ends in '." + extension + "' but the content is a " + type.name()
                    + " file. Use one of: ." + String.join(", .", type.extensions()) + ".");
        }
        return new Inspected(type, fileName, sha256(content));
    }

    /** The accepted type the bytes are, or null. */
    public static AttachmentType detect(byte[] content) {
        if (startsWith(content, PDF)) {
            return AttachmentType.PDF;
        }
        if (startsWith(content, PNG)) {
            return AttachmentType.PNG;
        }
        if (content.length >= 3 && (content[0] & 0xFF) == 0xFF && (content[1] & 0xFF) == 0xD8 && (content[2] & 0xFF) == 0xFF) {
            return AttachmentType.JPEG;
        }
        if (startsWith(content, ZIP)) {
            Set<String> entries = zipEntryNames(content);
            if (entries.contains("[Content_Types].xml")) {
                if (entries.contains("word/document.xml")) {
                    return AttachmentType.DOCX;
                }
                if (entries.contains("xl/workbook.xml")) {
                    return AttachmentType.XLSX;
                }
            }
        }
        return null;
    }

    /**
     * The name without any directory part or control characters, at most 200 characters with its
     * extension kept. A missing name becomes "attachment" with the type's extension.
     */
    static String cleanFileName(String original, AttachmentType type) {
        String name = original == null ? "" : original;
        name = name.substring(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
        name = name.replaceAll("[\\p{Cntrl}\"]", "").strip();
        if (name.isEmpty() || name.chars().allMatch(c -> c == '.')) {
            return "attachment." + type.extensions().get(0);
        }
        if (name.length() > MAX_FILE_NAME) {
            int dot = name.lastIndexOf('.');
            String extension = dot > 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
            name = name.substring(0, MAX_FILE_NAME - extension.length()) + extension;
        }
        return name;
    }

    private static String extensionOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot < 0 ? "" : fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** Entry names from the ZIP central directory; empty when the structure is not a valid ZIP. */
    private static Set<String> zipEntryNames(byte[] c) {
        int lowest = Math.max(0, c.length - 22 - 0xFFFF);
        for (int i = c.length - 22; i >= lowest; i--) {
            if (int32(c, i) != EOCD_SIGNATURE) {
                continue;
            }
            int entries = uint16(c, i + 10);
            long directoryOffset = uint32(c, i + 16);
            if (directoryOffset >= i) {
                return Set.of();
            }
            Set<String> names = new HashSet<>();
            int p = (int) directoryOffset;
            for (int e = 0; e < entries && e < MAX_ZIP_ENTRIES; e++) {
                if (p + 46 > c.length || int32(c, p) != CENTRAL_HEADER_SIGNATURE) {
                    return Set.of();
                }
                int nameLength = uint16(c, p + 28);
                int extraLength = uint16(c, p + 30);
                int commentLength = uint16(c, p + 32);
                if (p + 46 + nameLength > c.length) {
                    return Set.of();
                }
                names.add(new String(c, p + 46, nameLength, StandardCharsets.UTF_8));
                p += 46 + nameLength + extraLength + commentLength;
            }
            return names;
        }
        return Set.of();
    }

    private static boolean startsWith(byte[] content, byte[] prefix) {
        if (content.length < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (content[i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    private static int uint16(byte[] c, int at) {
        return (c[at] & 0xFF) | (c[at + 1] & 0xFF) << 8;
    }

    private static int int32(byte[] c, int at) {
        return (c[at] & 0xFF) | (c[at + 1] & 0xFF) << 8 | (c[at + 2] & 0xFF) << 16 | (c[at + 3] & 0xFF) << 24;
    }

    private static long uint32(byte[] c, int at) {
        return int32(c, at) & 0xFFFFFFFFL;
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available.", ex);
        }
    }

    static String describe(long bytes) {
        return bytes % (1024 * 1024) == 0 ? bytes / (1024 * 1024) + " MB" : bytes + " bytes";
    }
}
