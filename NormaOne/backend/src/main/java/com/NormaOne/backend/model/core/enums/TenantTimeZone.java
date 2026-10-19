package com.NormaOne.backend.model.core.enums;

public enum TenantTimeZone {
    ASIA_KOLKATA("Asia/Kolkata"),
    UTC("UTC"),
    AMERICA_NEW_YORK("America/New_York"),
    EUROPE_MADRID("Europe/Madrid");

    private final String timeZoneId;

    TenantTimeZone(String timeZoneId) {
        this.timeZoneId = timeZoneId;
    }

    public String getTimeZoneId() {
        return timeZoneId;
    }
}
