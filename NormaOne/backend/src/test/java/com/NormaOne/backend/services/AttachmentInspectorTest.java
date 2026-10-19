package com.NormaOne.backend.services;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.EnumSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.junit.jupiter.api.Test;

import com.NormaOne.backend.exceptions.AttachmentTooLargeException;
import com.NormaOne.backend.exceptions.InvalidAttachmentException;
import com.NormaOne.backend.model.notification.enums.AttachmentType;

/** The content check: the bytes decide the type; the name must agree; size and allow-list apply. */
class AttachmentInspectorTest {

    private static final byte[] PDF = "%PDF-1.7\n%%EOF".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0};
    private static final byte[] JPEG = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0};
    private static final Set<AttachmentType> ALL = EnumSet.allOf(AttachmentType.class);
    private static final long TEN_MB = 10L * 1024 * 1024;

    @Test
    void detectsEachAcceptedTypeFromItsContent() throws Exception {
        assertEquals(AttachmentType.PDF, AttachmentInspector.detect(PDF));
        assertEquals(AttachmentType.PNG, AttachmentInspector.detect(PNG));
        assertEquals(AttachmentType.JPEG, AttachmentInspector.detect(JPEG));
        assertEquals(AttachmentType.DOCX, AttachmentInspector.detect(zip("[Content_Types].xml", "word/document.xml")));
        assertEquals(AttachmentType.XLSX, AttachmentInspector.detect(zip("[Content_Types].xml", "xl/workbook.xml")));
        assertNull(AttachmentInspector.detect(zip("word/document.xml")), "no [Content_Types].xml: not an Office package");
        assertNull(AttachmentInspector.detect(zip("[Content_Types].xml", "ppt/presentation.xml")));
        assertNull(AttachmentInspector.detect("hello".getBytes(StandardCharsets.UTF_8)));
        assertNull(AttachmentInspector.detect(new byte[] {'P', 'K', 3, 4, 0, 0}), "a truncated ZIP is nothing");
    }

    @Test
    void acceptsAMatchingNameAndReportsTheChecksum() {
        AttachmentInspector.Inspected pdf = AttachmentInspector.inspect("Policy.PDF", PDF, TEN_MB, ALL);
        assertEquals(AttachmentType.PDF, pdf.type());
        assertEquals("Policy.PDF", pdf.fileName());
        assertEquals(64, pdf.checksumSha256().length());
        assertEquals("photo.jpeg", AttachmentInspector.inspect("photo.jpeg", JPEG, TEN_MB, ALL).fileName());
        assertEquals("photo.jpg", AttachmentInspector.inspect("photo.jpg", JPEG, TEN_MB, ALL).fileName());
    }

    @Test
    void refusesWhatTheContentDoesNotSupport() {
        assertThrows(InvalidAttachmentException.class, () -> AttachmentInspector.inspect("a.pdf", new byte[0], TEN_MB, ALL));
        assertThrows(InvalidAttachmentException.class,
                () -> AttachmentInspector.inspect("a.pdf", "<html>".getBytes(StandardCharsets.UTF_8), TEN_MB, ALL));
        InvalidAttachmentException mismatch = assertThrows(InvalidAttachmentException.class,
                () -> AttachmentInspector.inspect("image.pdf", PNG, TEN_MB, ALL));
        assertTrue(mismatch.getMessage().contains("PNG"));
        assertThrows(InvalidAttachmentException.class, () -> AttachmentInspector.inspect("noextension", PDF, TEN_MB, ALL));
        assertThrows(InvalidAttachmentException.class,
                () -> AttachmentInspector.inspect("a.pdf", PDF, TEN_MB, EnumSet.of(AttachmentType.PNG)), "not on the allow-list");
        assertThrows(AttachmentTooLargeException.class, () -> AttachmentInspector.inspect("a.pdf", PDF, 4, ALL));
    }

    @Test
    void keepsOnlyAPlainFileName() {
        assertEquals("report.pdf", AttachmentInspector.cleanFileName("../../etc/report.pdf", AttachmentType.PDF));
        assertEquals("report.pdf", AttachmentInspector.cleanFileName("C:\\Users\\me\\report.pdf", AttachmentType.PDF));
        assertEquals("evilname.pdf", AttachmentInspector.cleanFileName("evil\"\r\nname.pdf", AttachmentType.PDF));
        assertEquals("attachment.pdf", AttachmentInspector.cleanFileName(null, AttachmentType.PDF));
        assertEquals("attachment.png", AttachmentInspector.cleanFileName("..", AttachmentType.PNG));
        String longName = "x".repeat(300) + ".docx";
        String cleaned = AttachmentInspector.cleanFileName(longName, AttachmentType.DOCX);
        assertEquals(200, cleaned.length());
        assertTrue(cleaned.endsWith(".docx"));
    }

    private static byte[] zip(String... names) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (String name : names) {
                zip.putNextEntry(new ZipEntry(name));
                zip.write("<x/>".getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
}
