package com.NormaOne.backend.model.modules;

import com.NormaOne.backend.model.plans.enums.ModuleApps;

/**
 * What a member may do inside one application module. Stored by name in {@code user.modulePermissions}.
 *
 * Identifiers are {@code <MODULE>_<ACTION>}, with the module id from {@link ModuleApps}. Each module
 * has only the actions its documented requirements support: the four modules with a prototype
 * (FacturaFlow, JornadaPulse, DatosPilot, PrevenWork) map their prototype's role permissions onto
 * these (docs/AUTH_RBAC_GUIDE.md section 11); BuzonDesk and SafeVoice have no documented
 * requirements yet, so they have only VIEW and MANAGE, marked provisional.
 *
 * These are the only permissions in NormaOne. Platform and tenant administration (organizations,
 * users, notifications, plans) are decided by role and tenant, not by permissions. A user with no
 * module permissions stored has none: there is no "all by default" rule.
 *
 * Restricted data is not part of any coarse permission here: DatosPilot's health area and
 * PrevenWork's restricted incident detail and unredacted exports will need permissions of their own
 * when those modules' backends exist.
 */
public enum ModulePermission {

    // ==================== FACTURAFLOW ====================

    FACTURAFLOW_VIEW(ModuleApps.FACTURAFLOW, ModuleAction.VIEW,
            "Ver facturas, clientes, proveedores, gastos e informes",
            "View invoices, customers, suppliers, expenses, fiscal status and reports."),
    FACTURAFLOW_CREATE(ModuleApps.FACTURAFLOW, ModuleAction.CREATE,
            "Crear borradores de factura, clientes, proveedores y gastos",
            "Create draft invoices, customers, suppliers and expense claims."),
    FACTURAFLOW_EDIT(ModuleApps.FACTURAFLOW, ModuleAction.EDIT,
            "Editar borradores y registrar cobros, incidencias y recordatorios",
            "Edit drafts, request rectifications, record and reverse payments, manage disputes and reminders. Issued invoices are rectified, never edited."),
    FACTURAFLOW_APPROVE(ModuleApps.FACTURAFLOW, ModuleAction.APPROVE,
            "Aprobar y emitir facturas; revisar gastos",
            "Approve, issue and deliver invoices; review expense claims."),
    FACTURAFLOW_EXPORT(ModuleApps.FACTURAFLOW, ModuleAction.EXPORT,
            "Exportar datos y gestionar la entrega a la gestoría",
            "Create exports and manage the accountant (gestoría) handover."),
    FACTURAFLOW_MANAGE(ModuleApps.FACTURAFLOW, ModuleAction.MANAGE,
            "Configurar el módulo y ver su auditoría",
            "Configure the module (company settings, module users) and view its audit trail."),

    // ==================== JORNADAPULSE ====================

    JORNADAPULSE_VIEW(ModuleApps.JORNADAPULSE, ModuleAction.VIEW,
            "Ver registros de jornada, ausencias, turnos e informes",
            "View working-time records, absences, schedules, policies and reports."),
    JORNADAPULSE_CREATE(ModuleApps.JORNADAPULSE, ModuleAction.CREATE,
            "Fichar y solicitar correcciones y ausencias",
            "Clock in and out, and request corrections and absences."),
    JORNADAPULSE_EDIT(ModuleApps.JORNADAPULSE, ModuleAction.EDIT,
            "Planificar turnos, mantener empleados y proponer correcciones",
            "Plan shifts, maintain employees and propose corrections. Original records are never rewritten."),
    JORNADAPULSE_APPROVE(ModuleApps.JORNADAPULSE, ModuleAction.APPROVE,
            "Revisar correcciones, ausencias e incidencias",
            "Review corrections, absences and anomalies."),
    JORNADAPULSE_EXPORT(ModuleApps.JORNADAPULSE, ModuleAction.EXPORT,
            "Exportar informes de jornada",
            "Export working-time reports."),
    JORNADAPULSE_MANAGE(ModuleApps.JORNADAPULSE, ModuleAction.MANAGE,
            "Gestionar políticas, cierres de periodo y configuración",
            "Manage policies and settings, close periods and view the audit trail."),

    // ==================== DATOSPILOT ====================

    DATOSPILOT_VIEW(ModuleApps.DATOSPILOT, ModuleAction.VIEW,
            "Ver requisitos, evidencias, formación, EPI, riesgos, acciones y CAE",
            "View requirements, evidence, training, PPE, the risk register, preventive actions, CAE and readiness. Excludes the restricted health area."),
    DATOSPILOT_CREATE(ModuleApps.DATOSPILOT, ModuleAction.CREATE,
            "Subir y solicitar evidencias, registrar riesgos y redactar requisitos",
            "Upload and request evidence, register risks and draft requirement templates."),
    DATOSPILOT_EDIT(ModuleApps.DATOSPILOT, ModuleAction.EDIT,
            "Mantener empleados, centros, formación, EPI, acciones y CAE",
            "Maintain employees and worksites, assign requirements, and manage training, PPE, preventive actions, CAE and exceptions."),
    DATOSPILOT_APPROVE(ModuleApps.DATOSPILOT, ModuleAction.APPROVE,
            "Aprobar requisitos y revisar evidencias, riesgos y acciones",
            "Approve requirements, review evidence, risks and actions, and decide readiness and exceptions."),
    DATOSPILOT_EXPORT(ModuleApps.DATOSPILOT, ModuleAction.EXPORT,
            "Exportar informes con datos protegidos ocultos",
            "Export reports, with protected data redacted."),
    DATOSPILOT_MANAGE(ModuleApps.DATOSPILOT, ModuleAction.MANAGE,
            "Gestionar plantillas de requisitos y configuración",
            "Manage requirement templates and settings, and view the audit trail."),

    // ==================== PREVENWORK ====================

    PREVENWORK_VIEW(ModuleApps.PREVENWORK, ModuleAction.VIEW,
            "Ver tratamientos, derechos, resúmenes de incidentes, documentos y proveedores",
            "View processing activities, rights requests, incident summaries, documents, suppliers, retention and reports. Excludes restricted incident detail."),
    PREVENWORK_CREATE(ModuleApps.PREVENWORK, ModuleAction.CREATE,
            "Registrar tratamientos, solicitudes de derechos, incidentes y documentos",
            "Register processing activities, rights requests, incidents, documents and suppliers."),
    PREVENWORK_EDIT(ModuleApps.PREVENWORK, ModuleAction.EDIT,
            "Actualizar tratamientos, solicitudes, incidentes, documentos y tareas",
            "Update processing activities, rights requests, incidents, documents, suppliers and tasks."),
    PREVENWORK_DELETE(ModuleApps.PREVENWORK, ModuleAction.DELETE,
            "Ejecutar el borrado según las reglas de retención",
            "Carry out erasure under the retention rules."),
    PREVENWORK_APPROVE(ModuleApps.PREVENWORK, ModuleAction.APPROVE,
            "Revisar tratamientos, aprobar documentos y decidir sobre derechos e incidentes",
            "Review processing activities and suppliers, approve documents, and decide rights-request extensions, retention, incident notification and closure."),
    PREVENWORK_EXPORT(ModuleApps.PREVENWORK, ModuleAction.EXPORT,
            "Exportar informes estándar con datos ocultos",
            "Export standard reports, with protected data redacted."),
    PREVENWORK_MANAGE(ModuleApps.PREVENWORK, ModuleAction.MANAGE,
            "Gestionar la retención y la configuración",
            "Manage retention rules and settings, and view the audit trail."),

    // ==================== BUZONDESK (provisional) ====================

    BUZONDESK_VIEW(ModuleApps.BUZONDESK, ModuleAction.VIEW,
            "Acceder al módulo",
            "Open the module. Provisional: BuzonDesk has no documented requirements in this repository yet."),
    BUZONDESK_MANAGE(ModuleApps.BUZONDESK, ModuleAction.MANAGE,
            "Configurar el módulo",
            "Configure the module. Provisional: BuzonDesk has no documented requirements in this repository yet."),

    // ==================== SAFEVOICE (provisional) ====================

    SAFEVOICE_VIEW(ModuleApps.SAFEVOICE, ModuleAction.VIEW,
            "Acceder al módulo",
            "Open the module. Provisional: SafeVoice has no documented requirements in this repository yet."),
    SAFEVOICE_MANAGE(ModuleApps.SAFEVOICE, ModuleAction.MANAGE,
            "Configurar el módulo",
            "Configure the module. Provisional: SafeVoice has no documented requirements in this repository yet.");

    private final ModuleApps module;
    private final ModuleAction action;
    private final String label;
    private final String description;

    ModulePermission(ModuleApps module, ModuleAction action, String label, String description) {
        this.module = module;
        this.action = action;
        this.label = label;
        this.description = description;
    }

    public ModuleApps module() {
        return module;
    }

    public ModuleAction action() {
        return action;
    }

    /** Spanish display label, as the product's interfaces show it. */
    public String label() {
        return label;
    }

    public String description() {
        return description;
    }
}
