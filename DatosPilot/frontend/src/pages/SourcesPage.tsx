/**
 * Fuentes y pruebas: traceability guide open to every user. Official sources with their status,
 * the BRD requirements → what the mock-up does and where to try it (with a demo-user switch),
 * the decisions reserved to professionals and the known limitations of the prototype.
 * Transcribed from docs/01_REGULATORY_RESEARCH.md (12/10/2026). Never a compliance claim.
 */
import { BookOpen, ExternalLink, FlaskConical, Gavel, ListChecks, LogIn, Scale, ShieldAlert, UserCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Callout, Card, EmptyState, PageHeader } from '../components/ui';
import type { Tone } from '../domain/status';
import { t, tKey } from '../i18n';
import { switchIdentity } from '../services/opsService';
import { useCtx } from '../store/hooks';

const DEMO_COMPANY = 'cmp_levante';

type SourceStatus = 'in_force' | 'guidance' | 'draft' | 'out_of_scope';

const SOURCE_STATUS: Record<SourceStatus, { label: string; tone: Tone; help: string }> = {
  in_force: { label: tKey('Norma vigente'), tone: 'success', help: tKey('En vigor; comprobada en la fuente oficial el 12/10/2026.') },
  guidance: { label: tKey('Guía (no vinculante)'), tone: 'info', help: tKey('Criterio técnico u orientación de una autoridad; no es una norma.') },
  draft: { label: tKey('Proyecto (no es norma)'), tone: 'warning', help: tKey('Texto en tramitación: no se aplica en la maqueta.') },
  out_of_scope: { label: tKey('Fuera del alcance'), tone: 'neutral', help: tKey('Vigente, pero fuera del alcance de DatosPilot (BRD p. 13).') },
};

interface Source {
  id: string;
  title: string;
  ref: string;
  url: string | null;
  note: string;
  status: SourceStatus;
  /** Applicability to the demo companies must be confirmed by a professional. */
  review?: boolean;
}

const SOURCES: Source[] = [
  { id: 'L1', title: tKey('Ley 31/1995, de Prevención de Riesgos Laborales (LPRL)'), ref: 'BOE-A-1995-24292', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292', note: tKey('Arts. 16, 17, 18, 19, 22, 23, 24, 25, 28, 29, 30–31 y 33–36: evaluación, equipos, información, formación, vigilancia de la salud, documentación, coordinación, organización y participación.'), status: 'in_force' },
  { id: 'L2', title: tKey('Real Decreto 39/1997, Reglamento de los Servicios de Prevención (RSP)'), ref: 'BOE-A-1997-1853', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1997-1853', note: tKey('Evaluación y planificación (arts. 2–9), modalidades de organización (arts. 10–22) y vigilancia de la salud (art. 37).'), status: 'in_force' },
  { id: 'L3', title: tKey('Real Decreto 171/2004, coordinación de actividades empresariales (CAE)'), ref: 'BOE-A-2004-1848', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2004-1848', note: tKey('Información e instrucciones entre empresas concurrentes (arts. 4–13); por escrito cuando hay riesgos graves o muy graves.'), status: 'in_force' },
  { id: 'L4', title: tKey('Real Decreto 773/1997, equipos de protección individual (EPI)'), ref: 'BOE-A-1997-12735', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1997-12735', note: tKey('Elección, entrega gratuita, información y sustitución de los equipos (arts. 3–8).'), status: 'in_force' },
  { id: 'L5', title: tKey('Real Decreto 614/2001, riesgo eléctrico'), ref: 'BOE-A-2001-11881', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2001-11881', note: tKey('Formación e información (art. 5) y definición de trabajador autorizado (anexo I).'), status: 'in_force' },
  { id: 'L6', title: tKey('Real Decreto 843/2011, actividad sanitaria de los servicios de prevención'), ref: 'BOE-A-2011-11428', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2011-11428', note: tKey('Obliga al servicio de prevención, no a la empresa: la historia clínica queda fuera del portal.'), status: 'in_force' },
  { id: 'L7', title: tKey('Ley Orgánica 3/2018 (LOPDGDD)'), ref: 'BOE-A-2018-16673', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673', note: tKey('Art. 9: categorías especiales de datos, entre ellas los de salud.'), status: 'in_force' },
  { id: 'L8', title: tKey('Reglamento (UE) 2016/679 (RGPD)'), ref: 'CELEX 32016R0679', url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', note: tKey('Minimización (art. 5.1.c), datos de salud (art. 9), antecedentes penales (art. 10) y seguridad (art. 32).'), status: 'in_force' },
  { id: 'L9', title: tKey('Real Decreto Legislativo 5/2000 (LISOS)'), ref: 'BOE-A-2000-15060', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060', note: tKey('Solo contexto: prescripción (art. 4.3) e infracciones (arts. 11–13). No fija plazos de conservación.'), status: 'in_force' },
  { id: 'L10', title: tKey('Ley Orgánica 8/2021, de protección integral a la infancia'), ref: 'BOE-A-2021-9347', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2021-9347', note: tKey('Art. 57: certificado para el contacto habitual con menores. Su aplicación al personal de una contrata en un colegio está pendiente de revisión profesional.'), status: 'in_force', review: true },
  { id: 'L11', title: tKey('Real Decreto 1627/1997, obras de construcción'), ref: 'BOE-A-1997-22614', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-1997-22614', note: tKey('Construcción: fuera del alcance. Los riesgos de alcance especializado se rechazan en evaluaciones, centros y puestos.'), status: 'out_of_scope' },
  { id: 'L12', title: tKey('Ley 32/2006, subcontratación en el sector de la construcción'), ref: 'BOE-A-2006-18205', url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2006-18205', note: tKey('Construcción: fuera del alcance.'), status: 'out_of_scope' },
  { id: 'G1', title: tKey('AEPD, «La protección de datos en las relaciones laborales» (actualizada en diciembre de 2025)'), ref: 'AEPD', url: 'https://www.aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf', note: tKey('La empresa solo conoce la conclusión de aptitud o las tareas que se pueden realizar; el servicio de prevención custodia los datos clínicos.'), status: 'guidance' },
  { id: 'G2', title: tKey('INSST, coordinación de actividades empresariales'), ref: 'INSST', url: 'https://www.insst.es/materias/transversales/gestion-prevencion/cae', note: tKey('Orientaciones para el intercambio de información y los medios de coordinación.'), status: 'guidance' },
  { id: 'G3', title: tKey('INSST, guía técnica de equipos de protección individual'), ref: 'INSST', url: 'https://www.insst.es/', note: tKey('Guía técnica no vinculante (RD 773/1997, disposición final primera): recomienda registrar la entrega; la firma no es la única forma posible.'), status: 'guidance' },
  { id: 'D1', title: tKey('Reforma de la LPRL y del RD 39/1997 (anteproyecto aprobado por el Consejo de Ministros el 28/04/2026)'), ref: '—', url: null, note: tKey('No es norma. Entrada en vigor propuesta: 02/01/2027. No se aplica en la maqueta; queda en seguimiento.'), status: 'draft' },
];

interface Demo {
  userId: string;
  to: string;
  hint: string;
}

interface Requirement {
  id: string;
  text: string;
  does: string;
  where: { label: string; to: string };
  tests: string;
  demos: Demo[];
}

/** BRD requirement → implementation (docs/01 §3). */
const REQUIREMENTS: Requirement[] = [
  {
    id: 'PRL-01',
    text: tKey('Plantillas de requisitos por puesto y centro con aplicabilidad, fuente, profesional responsable, caducidad, revisión y fechas de efecto. La administración no puede inventar una regla médica obligatoria.'),
    does: tKey('Versiones con fecha de efecto y aprobación de cuatro ojos por la autoridad profesional. Solo el aprobador profesional marca un requisito como crítico; los requisitos de salud exigen aprobación médica con su base del art. 22.1.'),
    where: { label: tKey('Requisitos PRL'), to: '/requisitos' },
    tests: 'acc. 4, 6',
    demos: [{ userId: 'usr_javier', to: '/requisitos/tpl_vs_altura', hint: tKey('La administración abre el requisito de vigilancia de la salud en altura: no puede aprobarlo ni hacerlo obligatorio.') }],
  },
  {
    id: 'PRL-02',
    text: tKey('Cada asignación queda vinculada a la versión aplicable del requisito; un cambio de puesto o de centro abre una revisión de diferencias.'),
    does: tKey('Asignaciones con fecha de efecto y cálculo de los requisitos nuevos, los que dejan de aplicar y las evidencias a revisar. El cambio por sí solo no invalida ninguna evidencia.'),
    where: { label: tKey('Empleados → Puestos y centros'), to: '/empleados' },
    tests: 'acc. 1–3',
    demos: [{ userId: 'usr_javier', to: '/empleados/emp_pablo?tab=puestos', hint: tKey('Añada la Residencia Universitaria Nou Campus a Pablo Ruiz y revise la vista previa de diferencias.') }],
  },
  {
    id: 'PRL-03',
    text: tKey('Versionar formación, confirmaciones, entregas de equipos y evidencias: recibido, en revisión, aceptado, rechazado o sustituido.'),
    does: tKey('Subir no es aprobar; las versiones rechazadas se conservan; una sustitución crea una versión nueva. Decide la autoridad configurada, nunca quien presenta.'),
    where: { label: tKey('Documentación'), to: '/documentacion' },
    tests: 'acc. 7–10',
    demos: [{ userId: 'usr_marina', to: '/documentacion?revision=1', hint: tKey('Cola de revisión de la coordinación: acepte o rechace con motivo.') }],
  },
  {
    id: 'PRL-04',
    text: tKey('Conclusiones de aptitud restringidas, sin informes médicos completos, y cuarentena de archivos clínicos subidos por error.'),
    does: tKey('Área de salud solo para personal autorizado; la detección de términos clínicos envía el archivo a cuarentena; los intentos de acceso no autorizados se deniegan y quedan auditados.'),
    where: { label: tKey('Aptitud y vigilancia de la salud'), to: '/salud' },
    tests: 'acc. 14–17',
    demos: [{ userId: 'usr_clara', to: '/salud?tab=cuarentena', hint: tKey('La médica del trabajo gestiona los documentos en cuarentena.') }],
  },
  {
    id: 'PRL-05',
    text: tKey('Avisos a partir de fechas aprobadas de caducidad o revisión; documentos sin caducidad; revisiones periódicas sin falsos «caducado».'),
    does: tKey('Tres fechas separadas: caducidad legal, revisión del proveedor y seguimiento interno. Sin fecha, «Revisión necesaria»; «Caducado» solo con una caducidad real.'),
    where: { label: tKey('Incidencias y revisiones'), to: '/incidencias' },
    tests: 'acc. 11–13',
    demos: [{ userId: 'usr_marina', to: '/incidencias?tipo=missing_date', hint: tKey('Elementos con fecha o decisión pendiente: nunca se inventa un plazo.') }],
  },
  {
    id: 'PRL-06',
    text: tKey('Coordinación CAE con partes, riesgos, instrucciones, confirmaciones y acciones; enlaces limitados al centro y con caducidad.'),
    does: tKey('Enviado, recibido, confirmado y revisado son pasos distintos. Solo se comparten documentos aceptados, ordinarios y relevantes para el centro; los enlaces revocados o caducados se rechazan y se auditan.'),
    where: { label: tKey('Coordinación CAE'), to: '/cae' },
    tests: 'acc. 23–27',
    demos: [{ userId: 'usr_marina', to: '/cae/cae_001', hint: tKey('Prepare el paquete de un expediente: solo aparece la evidencia aceptada del centro.') }],
  },
  {
    id: 'PRL-07',
    text: tKey('La disponibilidad documental es distinta de la aprobación profesional de seguridad; un requisito crítico configurado bloquea la asignación.'),
    does: tKey('«Listo» solo se confirma si el estado derivado lo permite; las excepciones solo donde la versión aprobada las admite, nunca para una norma legal, con motivo, medida compensatoria y un máximo de 30 días.'),
    where: { label: tKey('Empleados → Resumen'), to: '/empleados' },
    tests: 'acc. 18–19, 22',
    demos: [{ userId: 'usr_marina', to: '/empleados/emp_ivan', hint: tKey('Iván Castelló está bloqueado por una formación crítica pendiente.') }],
  },
  {
    id: 'PRL-08',
    text: tKey('Paquete de evidencias por empleado o centro con versiones, decisiones y acciones abiertas, ocultando lo que el destinatario no puede recibir.'),
    does: tKey('El servicio reconstruye las filas desde el ámbito de quien exporta, enmascara la salud, declara los elementos abiertos y audita la exportación.'),
    where: { label: tKey('Informes y exportaciones'), to: '/informes' },
    tests: 'acc. 16, 25–27, 31',
    demos: [{ userId: 'usr_marina', to: '/informes', hint: tKey('Genere un paquete y revise las columnas ocultadas y los elementos abiertos.') }],
  },
  {
    id: 'AC-PRL-01',
    text: tKey('Cambiar el centro de un técnico: aparecen los requisitos nuevos y los documentos aceptados no relacionados siguen válidos.'),
    does: tKey('Vista previa de diferencias antes de guardar y revisión del cambio con su historial.'),
    where: { label: tKey('Empleados'), to: '/empleados' },
    tests: 'acc. 1–2',
    demos: [{ userId: 'usr_javier', to: '/empleados/emp_pablo?tab=puestos', hint: tKey('Añada la Residencia Universitaria Nou Campus a Pablo Ruiz: aparecen la formación PEMP y las instrucciones del centro.') }],
  },
  {
    id: 'AC-PRL-02',
    text: tKey('Documento sin caducidad aceptado, con una fecha de revisión aprobada aparte.'),
    does: tKey('Al decidir se indica «Sin caducidad» y, si procede, la fecha de revisión del proveedor, que se muestra con su etiqueta.'),
    where: { label: tKey('Documentación'), to: '/documentacion' },
    tests: 'acc. 11–12',
    demos: [{ userId: 'usr_marina', to: '/documentacion?nuevo=1', hint: tKey('Registre un documento cuyo emisor no establece caducidad.') }],
  },
  {
    id: 'AC-PRL-03',
    text: tKey('Una supervisora consulta un estado de aptitud e intenta abrir el adjunto clínico: ve solo el estado permitido, el adjunto no está disponible y el intento queda auditado.'),
    does: tKey('El elemento de salud aparece enmascarado; abrir el adjunto se deniega y genera un evento restringido; el área de salud está protegida.'),
    where: { label: tKey('Empleados → Requisitos'), to: '/empleados' },
    tests: 'acc. 14–15',
    demos: [
      { userId: 'usr_elena', to: '/empleados/emp_raul?tab=requisitos', hint: tKey('Intente abrir el adjunto clínico de Raúl Gómez: acceso denegado y auditado.') },
      { userId: 'usr_elena', to: '/salud', hint: tKey('Abra el área de salud sin permiso: acceso denegado.') },
    ],
  },
  {
    id: 'AC-PRL-04',
    text: tKey('La falta de una formación crítica mantiene bloqueada la disponibilidad hasta la revisión cualificada; el paquete CAE solo incluye evidencia aprobada y relevante para el centro.'),
    does: tKey('Estado «Bloqueado por requisito crítico» con su motivo; selección de documentos CAE limitada a los aceptados del centro.'),
    where: { label: tKey('Empleados'), to: '/empleados' },
    tests: 'acc. 18–19, 25',
    demos: [
      { userId: 'usr_marina', to: '/empleados/emp_ivan', hint: tKey('Iván Castelló: bloqueado por la formación crítica pendiente.') },
      { userId: 'usr_marina', to: '/cae/cae_001', hint: tKey('Paquete CAE: solo evidencia aceptada y relevante para el centro.') },
    ],
  },
  {
    id: 'PLT-05',
    text: tKey('Documentos versionados con tipo, fuente, quién lo sube, fechas, entidad vinculada, clase de acceso y estado de revisión.'),
    does: tKey('Cada documento tiene versiones con sus fechas y su decisión; la clase de acceso (ordinario, restringido, salud, cuarentena) limita quién lo ve.'),
    where: { label: tKey('Documentación'), to: '/documentacion' },
    tests: 'acc. 9–10',
    demos: [{ userId: 'usr_marina', to: '/documentacion', hint: tKey('Abra un documento y revise su historial de versiones.') }],
  },
  {
    id: 'PLT-06',
    text: tKey('Auditoría de solo inserción: creación, revisión, correcciones, permisos y exportaciones.'),
    does: tKey('Los eventos se generan desde las acciones de los servicios y se encadenan con un resumen de demostración.'),
    where: { label: tKey('Auditoría'), to: '/auditoria' },
    tests: 'acc. 27, 33–34',
    demos: [{ userId: 'usr_javier', to: '/auditoria', hint: tKey('Revise la cadena de eventos y su verificación de demostración.') }],
  },
  {
    id: 'PLT-07',
    text: tKey('Reglas versionadas: sin cambios silenciosos del historial y nada activo antes de su fecha de efecto.'),
    does: tKey('Una versión aprobada con fecha futura aparece como «Programada»; las evidencias conservan la versión del requisito con la que se revisaron.'),
    where: { label: tKey('Requisitos PRL'), to: '/requisitos' },
    tests: 'acc. 4–5',
    demos: [{ userId: 'usr_marina', to: '/requisitos', hint: tKey('Compare las versiones vigentes, programadas y sustituidas de un requisito.') }],
  },
];

/** Other demonstrations (scopes and access control). */
const EXTRA_DEMOS: (Demo & { title: string })[] = [
  { userId: 'usr_ramon', to: '/', title: tKey('Proveedor con el concierto finalizado'), hint: tKey('El acceso revocado no permite leer, descargar ni actuar.') },
  { userId: 'usr_jorge', to: '/', title: tKey('Técnico del servicio de prevención'), hint: tKey('Solo ve los centros de su concierto y revisa la evidencia que le corresponde.') },
  { userId: 'usr_andres', to: '/', title: tKey('Delegado de prevención'), hint: tKey('Información agregada, sin nombres ni datos de salud.') },
  { userId: 'usr_laura', to: '/', title: tKey('Propietaria'), hint: tKey('Estado operativo sin acceso al área de salud.') },
  { userId: 'usr_pablo', to: '/mis-tareas', title: tKey('Empleado'), hint: tKey('Sus propias tareas: confirmar información y equipos, aportar evidencia.') },
];

const PROFESSIONAL: string[] = [
  tKey('La modalidad de organización preventiva y si procede un plan simplificado (LPRL art. 30.5; RSP arts. 2.4 y 11).'),
  tKey('El método de evaluación, las valoraciones y cuándo revisar la evaluación (RSP arts. 4–6). DatosPilot no calcula puntuaciones.'),
  tKey('El contenido y la periodicidad de la formación (LPRL art. 19): no existe una periodicidad anual universal.'),
  tKey('Qué equipos de protección se necesitan y cuándo sustituirlos (RD 773/1997 arts. 4–6). El catálogo de la demostración es ilustrativo.'),
  tKey('Las excepciones a la voluntariedad de la vigilancia de la salud, con el informe previo de la representación (LPRL art. 22.1).'),
  tKey('CAE: si un riesgo es grave o muy grave (información por escrito) y si se designa una persona coordinadora (RD 171/2004 art. 13).'),
  tKey('Los plazos de conservación por tipo de documento y los bloqueos legales: la maqueta no fija ninguno.'),
  tKey('El alcance de construcción y de los riesgos especializados, excluidos de la maqueta.'),
  tKey('El alcance del acceso de la delegación de prevención (LPRL art. 36 con los límites del art. 22.4).'),
  tKey('Si el art. 57 de la LO 8/2021 se aplica al personal de una contrata en un colegio.'),
];

const LIMITATIONS: string[] = [
  tKey('Los datos se guardan en el almacenamiento local del navegador (localStorage), que no es un almacenamiento seguro. Un sistema real necesita un servidor con control de acceso.'),
  tKey('La cadena de resúmenes de la auditoría es de demostración: no es a prueba de manipulaciones.'),
  tKey('No hay envío real a terceros ni integración con servicios de prevención: los enlaces y los envíos son simulados.'),
  tKey('No se almacenan documentos clínicos: solo conclusiones de aptitud sin diagnóstico y una referencia externa.'),
  tKey('Las comprobaciones de permisos del navegador son una maqueta; el servidor real debe repetirlas.'),
  tKey('Los datos de la demostración son ficticios y las fechas se calculan respecto al día de la primera visita.'),
];

export function SourcesPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SourceStatus | ''>('');
  const sources = useMemo(() => (status ? SOURCES.filter((s) => s.status === status) : SOURCES), [status]);
  const name = (id: string) => ctx.db.users.find((u) => u.id === id)?.name ?? id;
  const isCurrent = (userId: string) => ctx.session.userId === userId && ctx.session.companyId === DEMO_COMPANY;
  const go = (d: Demo) => {
    if (!isCurrent(d.userId)) switchIdentity(d.userId, DEMO_COMPANY);
    navigate(d.to);
  };
  const demoButton = (d: Demo) => (
    <Button size="sm" icon={LogIn} onClick={() => go(d)} title={t(d.hint)}>
      {isCurrent(d.userId) ? t('Abrir como {name}', { name: name(d.userId) }) : t('Probar como {name}', { name: name(d.userId) })}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('Fuentes y pruebas')} subtitle={t('De cada requisito a la pantalla que lo demuestra, con las fuentes oficiales consultadas y los límites de la maqueta.')} />
      <div className="stack-lg">
        <Callout tone="warning" icon={FlaskConical} title={t('Prototipo con datos de demostración')}>
          {t('No es asesoramiento jurídico. DatosPilot coordina evidencias: no certifica el cumplimiento de ninguna norma ni declara que un centro de trabajo sea seguro. Las decisiones profesionales corresponden a personas cualificadas.')}
        </Callout>

        <Card
          flush
          title={<h2 className="row"><Scale size={16} aria-hidden /> {t('Fuentes oficiales')}</h2>}
          actions={
            <div className="field src-inline-field">
              <label htmlFor="src-status">{t('Situación de la fuente')}</label>
              <select id="src-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as SourceStatus | '')}>
                <option value="">{t('Todas')}</option>
                {(Object.keys(SOURCE_STATUS) as SourceStatus[]).map((k) => <option key={k} value={k}>{t(SOURCE_STATUS[k].label)}</option>)}
              </select>
            </div>
          }
          footer={<span className="tiny muted">{t('Identificadores y direcciones comprobados en la fuente oficial el 12/10/2026. BRD: ES-SME-BRD-001 v1.0.')}</span>}
        >
          <div className="src-legend">
            {(Object.keys(SOURCE_STATUS) as SourceStatus[]).map((k) => (
              <span key={k} className="row small" style={{ gap: 6 }}>
                <Badge tone={SOURCE_STATUS[k].tone} icon={false}>{t(SOURCE_STATUS[k].label)}</Badge>
                <span className="muted">{t(SOURCE_STATUS[k].help)}</span>
              </span>
            ))}
          </div>
          {sources.length === 0 ? (
            <EmptyState icon={BookOpen} title={t('Ninguna fuente con esta situación')} />
          ) : (
            <ul className="src-list">
              {sources.map((s) => (
                <li key={s.id} id={`fuente-${s.id}`}>
                  <div className="src-head">
                    <span className="tag">{s.id}</span>
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer noopener" className="strong">
                        {t(s.title)} <ExternalLink size={12} aria-hidden />
                        <span className="sr-only"> ({t('se abre en una pestaña nueva')})</span>
                      </a>
                    ) : (
                      <span className="strong">{t(s.title)}</span>
                    )}
                  </div>
                  <div className="row-wrap src-meta">
                    <Badge tone={SOURCE_STATUS[s.status].tone} icon={false} title={t(SOURCE_STATUS[s.status].help)}>{t(SOURCE_STATUS[s.status].label)}</Badge>
                    {s.review && <Badge tone="warning" icon={false}>{t('Aplicabilidad en revisión profesional')}</Badge>}
                    <code className="tiny">{s.ref}</code>
                  </div>
                  <div className="small muted">{t(s.note)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Callout tone="warning" icon={Gavel} title={t('Reforma de la LPRL y del RD 39/1997: no es norma')}>
          {t('El Consejo de Ministros aprobó el 28/04/2026 el anteproyecto de reforma. Sigue en tramitación, su entrada en vigor propuesta es el 02/01/2027 y no se aplica en DatosPilot. Se revisará cuando se publique en el BOE.')}
        </Callout>

        <Card flush title={<h2 className="row"><ListChecks size={16} aria-hidden /> {t('Requisitos del BRD y su implementación')}</h2>} footer={<span className="tiny muted">{t('«Probar como…» cambia el usuario de demostración (queda en la auditoría) y abre la pantalla indicada.')}</span>}>
          <div className="table-wrap">
            <table className="table src-table">
              <caption className="sr-only">{t('Requisito, qué hace la maqueta, dónde verlo y cómo probarlo')}</caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Requisito')}</th>
                  <th>{t('Qué hace la maqueta')}</th>
                  <th>{t('Dónde verlo')}</th>
                  <th>{t('Probar')}</th>
                </tr>
              </thead>
              <tbody>
                {REQUIREMENTS.map((r) => (
                  <tr key={r.id}>
                    <td className="strong nowrap" data-label="#">{r.id}</td>
                    <td className="small src-text" data-label={t('Requisito')}>{t(r.text)}</td>
                    <td className="small src-text" data-label={t('Qué hace la maqueta')}>
                      {t(r.does)}
                      <div className="tiny muted">{t('Pruebas de aceptación')}: {r.tests}</div>
                    </td>
                    <td className="small" data-label={t('Dónde verlo')}><Link to={r.where.to}>{t(r.where.label)}</Link></td>
                    <td data-label={t('Probar')}>
                      <div className="stack-sm src-demos">
                        {r.demos.map((d, i) => (
                          <div key={i} className="stack-sm" style={{ gap: 2 }}>
                            {demoButton(d)}
                            <span className="tiny muted">{t(d.hint)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={<h2 className="row"><UserCheck size={16} aria-hidden /> {t('Otras demostraciones de acceso')}</h2>}>
          <ul className="src-demo-grid">
            {EXTRA_DEMOS.map((d) => (
              <li key={d.userId}>
                <div className="strong small">{t(d.title)}</div>
                <div className="tiny muted">{t(d.hint)}</div>
                {demoButton(d)}
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid-2">
          <Card title={<h2 className="row"><Scale size={16} aria-hidden /> {t('Decisiones reservadas a profesionales')}</h2>} footer={<span className="tiny muted">{t('Deben confirmarlas un técnico de prevención, el servicio médico o una asesoría laboral o de protección de datos antes de un uso real.')}</span>}>
            <ol className="src-ol small">
              {PROFESSIONAL.map((p) => <li key={p}>{t(p)}</li>)}
            </ol>
          </Card>
          <Card title={<h2 className="row"><ShieldAlert size={16} aria-hidden /> {t('Limitaciones de la maqueta')}</h2>}>
            <ul className="src-ol small">
              {LIMITATIONS.map((p) => <li key={p}>{t(p)}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
