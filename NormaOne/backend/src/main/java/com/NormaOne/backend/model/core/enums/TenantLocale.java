package com.NormaOne.backend.model.core.enums;

public enum TenantLocale {
    EN_IN("en-IN"),
    EN_US("en-US"),
    ES_ES("es-ES"),
    ES_MX("es-MX");

    private final String code;

    TenantLocale(String code) {
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
