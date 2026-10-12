import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Callout, Card, PageHeader, Tabs } from '../components/ui';
import { t, tKey } from '../i18n';

interface Req {
  id: string;
  priority: 'P0' | 'P1' | 'C';
  status: 'implemented' | 'partial' | 'conditional';
  title: string;
  where: { label: string; to: string }[];
  demo: string;
  test?: string;
  open?: string;
}

const FIN: Req[] = [
  { id: 'FIN-01', priority: 'P0', status: 'implemented', title: tKey('Perfil del contribuyente y decisiones de aplicabilidad SIF/B2B separadas; bloqueo de emisión con motivo y responsable.'), where: [{ label: tKey('Configuración → Fiscal'), to: '/configuracion?tab=fiscal' }, { label: tKey('Integración fiscal'), to: '/integracion-fiscal' }], demo: tKey('Cambie a la empresa Instalaciones Ibaigane (Bizkaia): la emisión aparece bloqueada con cada motivo y su responsable.'), test: 'AC-FIN-04', open: 'U1, U3' },
  { id: 'FIN-02', priority: 'P0', status: 'implemented', title: tKey('Clientes/proveedores, series configurables, validación de campos, totales y tratamiento fiscal antes de aprobar.'), where: [{ label: tKey('Nueva factura'), to: '/facturas/nueva' }, { label: tKey('Clientes'), to: '/clientes' }, { label: tKey('Series'), to: '/configuracion?tab=series' }], demo: tKey('Cree una factura con una línea "Exenta (art. 20)": la aprobación se bloquea porque el tratamiento no está aprobado para la empresa.'), test: 'Domain calculations', open: 'U6, U7' },
  { id: 'FIN-03', priority: 'P0', status: 'implemented', title: tKey('Emisión mediante proveedor con clave única de operación; sin duplicados ante reintentos o tiempos de espera.'), where: [{ label: tKey('Integración fiscal'), to: '/integracion-fiscal' }], demo: tKey('Como Marta Soler, emita la factura aprobada de Clínica Dental con el escenario "Tiempo de espera — SÍ procesada", intente emitir de nuevo (bloqueado) y concilie.'), test: 'AC-FIN-01' },
  { id: 'FIN-04', priority: 'P0', status: 'implemented', title: tKey('Original, identificadores del proveedor, resultado fiscal e historial; documento, fiscal, envío y cobro como estados independientes.'), where: [{ label: tKey('Facturas'), to: '/facturas' }], demo: tKey('Abra cualquier factura: la cabecera muestra los cuatro estados por separado con su explicación.'), test: 'AC-FIN-02' },
  { id: 'FIN-05', priority: 'P0', status: 'implemented', title: tKey('Rectificativas vinculadas con motivo autorizado; sin borrado ni edición de facturas emitidas.'), where: [{ label: tKey('Factura F2026-0007 (rectificada)'), to: '/facturas/inv_lev_007' }], demo: tKey('En una factura emitida pulse "Corregir…": rectificar, anular registro (revisión profesional) y cancelar (no disponible) se muestran como operaciones distintas.'), test: 'AC-FIN-03', open: 'U10' },
  { id: 'FIN-06', priority: 'P0', status: 'implemented', title: tKey('Facturas recibidas y gastos; duplicados, aprobación y conservación del justificante. El reconocimiento de documentos no aprueba ni fija el tratamiento fiscal.'), where: [{ label: tKey('Gastos'), to: '/gastos' }], demo: tKey('Como Elena Navarro (supervisora), intente aprobar la compra de racores de 450 €: supera su límite. Revise el duplicado FIT-2026-04412.'), test: 'FIN-06 — expenses' },
  { id: 'FIN-07', priority: 'P0', status: 'implemented', title: tKey('Vencimientos, cobros parciales y totales, disputas; recordatorios suprimidos tras el cobro o con retención por disputa.'), where: [{ label: tKey('Cobros'), to: '/cobros' }], demo: tKey('Cobros → Recordatorios: la factura en disputa aparece como "Suprimir". Registre un cobro en efectivo ≥ 1.000 € y compruebe el bloqueo.'), test: 'FIN-07 — payments' },
  { id: 'FIN-08', priority: 'P0', status: 'implemented', title: tKey('Exportación por periodo para la gestoría con originales, excepciones y totales; versión del componente y declaración responsable visibles.'), where: [{ label: tKey('Gestoría'), to: '/gestoria' }], demo: tKey('Como Carlos Gil (gestoría), abra el traspaso de septiembre, revise excepciones y descargue el paquete JSON.') },
  { id: 'FIN-09', priority: 'C', status: 'conditional', title: tKey('Factura electrónica B2B estructurada, acuses y comunicación de estado mediante el proveedor.'), where: [{ label: tKey('Configuración → Fiscal'), to: '/configuracion?tab=fiscal' }], demo: tKey('No implementado (condicional). Fije una fecha simulada posterior al plazo B2B con volumen > 8 M€: la emisión se bloquea por falta de conector validado.'), test: 'AC-FIN-04', open: 'U3, U4' },
];

const PLATFORM: Req[] = [
  { id: 'PLT-01', priority: 'P0', status: 'implemented', title: tKey('Espacio de empresa con perfil revisado y bloqueos con motivo y responsable.'), where: [{ label: tKey('Configuración → Empresa'), to: '/configuracion?tab=empresa' }], demo: tKey('Empresa Ibaigane: perfil sin revisar → bloqueo.') },
  { id: 'PLT-02', priority: 'P0', status: 'implemented', title: tKey('Registros con identificadores estables y aislamiento por empresa en búsqueda, enlaces e informes.'), where: [{ label: tKey('Búsqueda superior'), to: '/' }], demo: tKey('Con Mantenimientos Levante activa, abra /facturas/inv_ibg_001: "Registro no disponible".'), test: 'AC-PLT-01' },
  { id: 'PLT-03', priority: 'P0', status: 'partial', title: tKey('Permisos por rol y acción, delegaciones con caducidad y revocación inmediata. MFA y autorización en servidor: pendiente de backend.'), where: [{ label: tKey('Usuarios y permisos'), to: '/configuracion?tab=usuarios' }], demo: tKey('Revoque el acceso de la gestoría y cambie a ese usuario: sin acceso.'), test: 'AC-PLT-02' },
  { id: 'PLT-04', priority: 'P0', status: 'implemented', title: tKey('Bandeja de tareas con responsable, suplente, origen, fecha, regla de evidencia y distinción plazo legal / objetivo interno.'), where: [{ label: tKey('Tareas'), to: '/tareas' }], demo: tKey('Tareas muestra el plazo legal del RRSIF y objetivos internos de conciliación.') },
  { id: 'PLT-05', priority: 'P0', status: 'partial', title: tKey('Documentos versionados con origen, autor, fechas, entidad, clase de acceso. Subir ≠ aprobar.'), where: [{ label: tKey('Gastos'), to: '/gastos' }], demo: tKey('Sustituya un justificante: se crea la v2 y se conserva la v1.') },
  { id: 'PLT-06', priority: 'P0', status: 'implemented', title: tKey('Auditoría de solo inserción con actor, empresa, hora, motivo y valores anterior/actual.'), where: [{ label: tKey('Auditoría'), to: '/auditoria' }], demo: tKey('La cadena de huellas se verifica al abrir Auditoría.'), test: 'PLT-06' },
  { id: 'PLT-07', priority: 'P0', status: 'implemented', title: tKey('Reglas versionadas con fuente, revisor y entrada en vigor; sin efectos retroactivos ni anticipados.'), where: [{ label: tKey('Reglas y fuentes'), to: '/configuracion?tab=reglas' }], demo: tKey('El plazo SIF muestra tres versiones y un anuncio no aplicado.'), test: 'AC-PLT-03' },
  { id: 'PLT-08', priority: 'P0', status: 'partial', title: tKey('Avisos en la aplicación y recordatorios (correo simulado) con visibilidad de fallos; sin datos sensibles en avisos.'), where: [{ label: tKey('Avisos'), to: '/tareas?tab=avisos' }], demo: tKey('Emita con el escenario "Rechazo": aparece un aviso sin importes.') },
  { id: 'PLT-09', priority: 'P0', status: 'implemented', title: tKey('Interfaz en español, EUR, fechas dd/mm/aaaa, Europe/Madrid, búsqueda acotada y exportaciones.'), where: [{ label: tKey('Informes'), to: '/informes' }], demo: tKey('Exporte cualquier lista en CSV (separador ;) o JSON.') },
  { id: 'PLT-10', priority: 'P0', status: 'partial', title: tKey('Conservación y cierre controlado: archivar en lugar de borrar; facturas emitidas no eliminables; restablecimiento explícito de la demo.'), where: [{ label: tKey('Datos de demostración'), to: '/configuracion?tab=datos' }], demo: tKey('Archive un cliente: sus facturas siguen accesibles.') },
  { id: 'AC-PLT-04', priority: 'P0', status: 'implemented', title: tKey('Una excepción crítica no se cierra sin evidencia (resultado del proveedor).'), where: [{ label: tKey('Integración fiscal'), to: '/integracion-fiscal' }], demo: tKey('No existe acción "marcar resuelta": solo conciliar o reenviar.') },
];

const STATUS = { implemented: { label: tKey('Implementado'), tone: 'success' as const }, partial: { label: tKey('Parcial (límite del prototipo)'), tone: 'warning' as const }, conditional: { label: tKey('Condicional — desactivado'), tone: 'neutral' as const } };

/** Demo users: [person, company, role, what to try]. Names and company names are data. */
const DEMO_USERS: [string, string, string, string][] = [
  ['Laura Martín', 'Mantenimientos Levante', tKey('Propietaria'), tKey('Configuración, usuarios, todo el módulo')],
  ['Javier Ortega', 'Mantenimientos Levante', tKey('Administración'), tKey('Borradores, clientes, cobros, gastos de proveedores; no puede aprobar ni emitir')],
  ['Marta Soler', 'Mantenimientos Levante', tKey('Emisora autorizada'), tKey('Aprobar, emitir, conciliar, subsanar')],
  ['Elena Navarro', 'Mantenimientos Levante', tKey('Supervisora (límite 300 €)'), tKey('Revisión de gastos del equipo')],
  ['Pablo Ruiz / Sergio Llopis', 'Mantenimientos Levante', tKey('Empleados'), tKey('Presentar gastos propios con justificante')],
  ['Carlos Gil', tKey('Levante y Carmen Ruiz'), tKey('Gestoría'), tKey('Traspasos, exportaciones; sin borradores ni datos de RR. HH.')],
  ['Nuria Campos', 'Mantenimientos Levante', tKey('Gestoría (revocada)'), tKey('Acceso denegado tras la revocación')],
  ['Carmen Ruiz', tKey('Carmen Ruiz (autónoma)'), tKey('Titular'), tKey('Facturas con retención IRPF; plazo SIF 1/7/2027')],
  ['Iker Etxeberria', 'Instalaciones Ibaigane', tKey('Titular'), tKey('Configuración foral no soportada: emisión bloqueada')],
];

export function RequirementsPage() {
  const [tab, setTab] = useState<'fin' | 'plt' | 'users'>('fin');
  const list = tab === 'fin' ? FIN : PLATFORM;
  return (
    <>
      <PageHeader title={t('Requisitos y pruebas')} subtitle={t('Trazabilidad entre los requisitos del BRD, las pantallas y las pruebas de aceptación. Detalle completo en docs/02_TRACEABILITY_AND_PLAN.md.')} />
      <div style={{ marginBottom: 12 }}>
        <Callout tone="warning" title={t('Este prototipo no certifica el cumplimiento legal')}>
          {t('Implementa los flujos y controles del BRD con datos ficticios y un proveedor fiscal simulado. Las reglas fiscales y laborales requieren revisión por profesionales españoles cualificados antes de cualquier uso real.')}
        </Callout>
      </div>
      <Tabs label={t('Grupos de requisitos')} value={tab} onChange={setTab} tabs={[{ id: 'fin', label: t('Facturas y Gastos (FIN)') }, { id: 'plt', label: t('Plataforma compartida') }, { id: 'users', label: t('Usuarios de demostración') }]} />
      {tab !== 'users' ? (
        <Card flush>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('Requisito')}</th><th>{t('Estado')}</th><th>{t('Dónde')}</th><th>{t('Cómo demostrarlo')}</th><th>{t('Prueba automática')}</th><th>{t('Pendiente')}</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td style={{ minWidth: 260 }}><strong>{r.id}</strong> <Badge tone="neutral" icon={false}>{r.priority}</Badge><div className="small">{t(r.title)}</div></td>
                    <td><Badge tone={STATUS[r.status].tone}>{t(STATUS[r.status].label)}</Badge></td>
                    <td className="small">{r.where.map((w) => <div key={w.to}><Link to={w.to}>{t(w.label)}</Link></div>)}</td>
                    <td className="small" style={{ minWidth: 240 }}>{t(r.demo)}</td>
                    <td className="small mono">{r.test ?? '—'}</td>
                    <td className="small">{r.open ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer small muted">{t('Pruebas automáticas:')} <span className="mono">npm test</span> {t('(Vitest) ejecuta los escenarios AC-FIN-01…04 y AC-PLT-01…03 contra la capa de servicios, que es el contrato de la futura API.')}</div>
        </Card>
      ) : (
        <Card title={t('Usuarios de demostración (selector arriba a la derecha)')}>
          <table className="table">
            <thead><tr><th>{t('Persona')}</th><th>{t('Empresa')}</th><th>{t('Rol')}</th><th>{t('Para probar')}</th></tr></thead>
            <tbody>
              {DEMO_USERS.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i === 0 ? 'strong' : 'small'}>{i === 0 ? c : t(c)}</td>)}</tr>)}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
