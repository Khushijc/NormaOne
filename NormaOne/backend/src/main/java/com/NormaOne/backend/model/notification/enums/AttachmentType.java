package com.NormaOne.backend.model.notification.enums;

import java.util.List;

/**
 * The file types a notification attachment may be. The type is decided from the file's content
 * (AttachmentInspector), never from the name or the MIME type the client sent; the stored
 * content type is this type's own.
 */
public enum AttachmentType {
    PDF("application/pdf", List.of("pdf")),
    PNG("image/png", List.of("png")),
    JPEG("image/jpeg", List.of("jpg", "jpeg")),
    DOCX("application/vnd.openxmlformats-officedocument.wordprocessingml.document", List.of("docx")),
    XLSX("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", List.of("xlsx"));

    private final String mimeType;
    private final List<String> extensions;

    AttachmentType(String mimeType, List<String> extensions) {
        this.mimeType = mimeType;
        this.extensions = extensions;
    }

    public String mimeType() {
        return mimeType;
    }

    /** Lower-case file name extensions, without the dot; the first is the canonical one. */
    public List<String> extensions() {
        return extensions;
    }
}
