/**
 * Requisitos y pruebas: demo guide for everyone. Transcribes the requirement map of
 * docs/01_REGULATORY_RESEARCH.md (section C), the sources (B) and the items for professional
 * review (E), plus the acceptance scenarios and demo users of docs/02 (§6–7).
 * Honest by design: prototype, not legal advice, no compliance claim.
 */
import { BookCheck, ExternalLink, FlaskConical, LogIn, Scale, TestTube2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Callout, Card, PageHeader } from '../components/ui';
import type { Tone } from '../domain/status';
import { t, tKey } from '../i18n';
import { switchIdentity } from '../services/opsService';
import { useCtx } from '../store/hooks';

type Applicability = 'legal' | 'brd' | 'draft' | 'config' | 'review' | 'design' | 'deferred';

const APPLICABILITY: Record<Applicability, { label: string; tone: Tone; help: string }> = {
  legal: { label: tKey('Norma vigente'), tone: 'success', help: tKey('En vigor; leída en la fuente oficial (BOE, EUR-Lex, CURIA, AEPD).') },
  brd: { label: tKey('BRD'), tone: 'info', help: tKey('Requisito de producto del BRD, no necesariamente una norma legal.') },
  draft: { label: tKey('Proyecto (no vigente)'), tone: 'warning', help: tKey('Borrador oficial no publicado en el BOE: la aplicación se prepara, pero no lo presenta como obligación.') },
  config: { label: tKey('Configurable'), tone: 'accent', help: tKey('Depende del convenio, el contrato, un acuerdo de empresa o la política del empleador; se guarda versionado.') },
  review: { label: tKey('Revisión profesional'), tone: 'warning', help: tKey('Interpretación que debe confirmar una asesoría laboral antes de un uso real.') },
  design: { label: tKey('Diseño'), tone: 'neutral', help: tKey('Recomendación de diseño del producto, no requisito legal ni del BRD.') },
  deferred: { label: tKey('Fuera del alcance'), tone: 'neutral', help: tKey('Aplazado: no se implementa en el prototipo.') },
};

interface Requirement {
  id: string;
  text: string;
  /** Source ids (L1…L12 = official sources below; BRD = business requirements document). */
  source: string;
  kinds: Applicability[];
  where: { label: string; to: string } | null;
  demo: string;
}

/** Transcribed from docs/01_REGULATORY_RESEARCH.md, section C. */
const REQUIREMENTS: Requirement[] = [
  { id: 'R01', text: tKey('Registro diario con la hora concreta de inicio y fin de la jornada de cada persona.'), source: 'L1 art. 34.9 · BRD TIM-02', kinds: ['legal'], where: { label: tKey('Mi jornada'), to: '/mi-jornada' }, demo: tKey('Fiche entrada y salida con un empleado: el registro aparece en hora local con su zona horaria.') },
  { id: 'R02', text: tKey('Conservar los registros cuatro años, a disposición de trabajadores, representantes e Inspección.'), source: 'L1 art. 34.9 · BRD TIM-07, AC-TIM-04', kinds: ['legal'], where: { label: tKey('Detalle de registro'), to: '/registros' }, demo: tKey('Con Javier, intente eliminar un registro de 2023 de Teresa Vidal: se bloquea y queda auditado.') },
  { id: 'R03', text: tKey('Tiempo parcial: registro día a día, total mensual y copia del resumen con la nómina.'), source: 'L1 art. 12.4.c · BRD TIM-06, AC-TIM-03', kinds: ['legal'], where: { label: tKey('Resumen mensual tiempo parcial'), to: '/informes?informe=parcial' }, demo: tKey('Resumen de Lucía Martínez: días, total mensual, versión y fecha de generación.') },
  { id: 'R04', text: tKey('Horas extraordinarias: registro diario totalizado en el periodo de pago, sin clasificación automática.'), source: 'L1 art. 35.5', kinds: ['legal'], where: { label: tKey('Resumen mensual por empleado'), to: '/informes?informe=resumen' }, demo: tKey('El resumen da totales por periodo y no clasifica horas extraordinarias.') },
  { id: 'R05', text: tKey('El registro se organiza por convenio, acuerdo de empresa o decisión previa consulta a la representación.'), source: 'L1 art. 34.9', kinds: ['config'], where: { label: tKey('Configuración'), to: '/configuracion' }, demo: tKey('Consulte la base y la versión del protocolo; sin protocolo vigente no se puede cerrar un periodo.') },
  { id: 'R06', text: tKey('Sistema objetivo, fiable y accesible.'), source: 'L5 · L4', kinds: ['legal'], where: { label: tKey('Registros horarios'), to: '/registros' }, demo: tKey('Tras una corrección aprobada, el detalle del registro sigue mostrando los valores originales.') },
  { id: 'R07', text: tKey('Registrar inicio, fin y pausas con hora del evento, hora de recepción, zona, origen e identificador; recibo duradero.'), source: 'BRD TIM-02', kinds: ['brd'], where: { label: tKey('Mi jornada'), to: '/mi-jornada' }, demo: tKey('El recibo solo aparece después de guardar el evento.') },
  { id: 'R08', text: tKey('Fallo de conexión: mostrar «No registrado» y una vía de corrección documentada.'), source: 'BRD §09 · L3 art. 4.d', kinds: ['brd', 'draft'], where: { label: tKey('Mi jornada'), to: '/mi-jornada' }, demo: tKey('Active el fallo simulado y fiche: aparece «No registrado» con «Solicitar corrección».') },
  { id: 'R09', text: tKey('Los clics repetidos no duplican eventos y las transiciones imposibles se bloquean.'), source: 'BRD TIM-03', kinds: ['brd', 'design'], where: { label: tKey('Mi jornada'), to: '/mi-jornada' }, demo: tKey('Pulse dos veces «Entrada»: un solo evento con el mismo recibo.') },
  { id: 'R10', text: tKey('Señalar sesiones ausentes, duplicadas, solapadas o largas como revisión, no como falta.'), source: 'BRD TIM-03', kinds: ['brd'], where: { label: tKey('Incidencias'), to: '/incidencias' }, demo: tKey('Lenguaje neutro; resolver una incidencia no modifica el registro.') },
  { id: 'R11', text: tKey('Un turno planificado nunca se convierte en tiempo trabajado; no se descuentan pausas ni se limitan horas.'), source: 'BRD §09, TIM-03', kinds: ['brd'], where: { label: tKey('Calendario'), to: '/calendario' }, demo: tKey('El calendario separa las capas «Planificado» y «Registrado».') },
  { id: 'R12', text: tKey('Horas extraordinarias y complementarias dependen de la configuración: no hay una regla universal.'), source: 'BRD §09 · L1 arts. 12.5, 35', kinds: ['config'], where: { label: tKey('Turnos y horarios'), to: '/turnos' }, demo: tKey('Los indicadores se etiquetan como configurables y llevan la versión de la política.') },
  { id: 'R13', text: tKey('Descanso mínimo de 12 horas entre jornadas.'), source: 'L1 art. 34.3 · L4 art. 3', kinds: ['legal', 'config'], where: { label: tKey('Registros horarios'), to: '/registros' }, demo: tKey('El indicador «Descanso corto» solo señala; nunca bloquea el fichaje.') },
  { id: 'R14', text: tKey('Máximo de nueve horas ordinarias diarias salvo otra distribución pactada.'), source: 'L1 art. 34.3', kinds: ['config'], where: { label: tKey('Turnos y horarios'), to: '/turnos' }, demo: tKey('Umbral por política (9 h por defecto) con fuente, autor y fecha de efecto.') },
  { id: 'R15', text: tKey('Pausa de al menos 15 minutos si la jornada continuada supera seis horas; retribuida solo si se pacta.'), source: 'L1 art. 34.4 · L4 art. 4', kinds: ['legal', 'config'], where: { label: tKey('Turnos y horarios'), to: '/turnos' }, demo: tKey('La política de limpieza v2 retribuye la pausa desde este mes; los meses anteriores usan la v1.') },
  { id: 'R16', text: tKey('Descanso semanal de día y medio y vacaciones de al menos 30 días naturales.'), source: 'L1 arts. 37.1, 38.1 · L4 arts. 5, 7', kinds: ['legal', 'config'], where: { label: tKey('Ausencias'), to: '/ausencias' }, demo: tKey('El saldo solo aparece si la asesoría ha aprobado la asignación.') },
  { id: 'R17', text: tKey('Trabajo nocturno entre las 22:00 y las 06:00; clasificación del trabajador nocturno.'), source: 'L1 art. 36.1', kinds: ['legal', 'review'], where: { label: tKey('Registros horarios'), to: '/registros' }, demo: tKey('Indicador «Nocturno» en las sesiones nocturnas de Sergio Llopis.') },
  { id: 'R18', text: tKey('Permisos retribuidos legales, que el convenio a menudo mejora.'), source: 'L1 art. 37.3, 37.9', kinds: ['legal', 'config'], where: { label: tKey('Configuración'), to: '/configuracion' }, demo: tKey('Tipos de ausencia con referencia legal y aviso de revisar el convenio.') },
  { id: 'R19', text: tKey('La reducción de jornada por cuidado de familiares cambia el 23/10/2026.'), source: 'L2', kinds: ['legal'], where: { label: tKey('Equipo'), to: '/equipo' }, demo: tKey('Condiciones laborales con fecha de efecto (Marta Soler); sin recálculo automático.') },
  { id: 'R20', text: tKey('Baja médica: no se piden partes ni diagnóstico; el INSS comunica la baja a la empresa.'), source: 'L9 · L6 art. 9', kinds: ['legal'], where: { label: tKey('Ausencias'), to: '/ausencias' }, demo: tKey('La categoría de baja médica no tiene campo de diagnóstico ni adjuntos.') },
  { id: 'R21', text: tKey('Sin fichaje biométrico.'), source: 'L8 · L6 art. 9 · BRD §09', kinds: ['legal', 'brd'], where: { label: tKey('Configuración'), to: '/configuracion' }, demo: tKey('Orígenes de fichaje: web, app móvil, terminal con PIN y corrección.') },
  { id: 'R22', text: tKey('Geolocalización y desconexión digital con garantías específicas.'), source: 'L7 arts. 88, 90', kinds: ['legal'], where: { label: tKey('Mi jornada'), to: '/mi-jornada' }, demo: tKey('No se capturan coordenadas: el centro de trabajo se elige de una lista.') },
  { id: 'R23', text: tKey('Festivos nacionales, autonómicos y locales según el centro de trabajo.'), source: 'L10', kinds: ['legal'], where: { label: tKey('Calendario'), to: '/calendario' }, demo: tKey('Capa de festivos en el calendario; un festivo nunca crea asistencia.') },
  { id: 'R24', text: tKey('Cambio de hora: instantes inequívocos y duración real de los turnos nocturnos.'), source: 'BRD AC-TIM-02 · L11', kinds: ['brd', 'legal'], where: { label: tKey('Registros horarios'), to: '/registros?desde=2026-03-28&hasta=2026-03-29' }, demo: tKey('Turno de Sergio Llopis del 28 al 29/03/2026: siete horas reales.') },
  { id: 'R25', text: tKey('Correcciones con valores original, solicitado y aprobado, revisor, fecha y aviso del resultado.'), source: 'BRD TIM-04, AC-TIM-01', kinds: ['brd'], where: { label: tKey('Solicitudes de corrección'), to: '/correcciones' }, demo: tKey('Corrección de Pablo Ruiz: los tres valores y el historial de revisión.') },
  { id: 'R26', text: tKey('Modificaciones con conformidad de empresa y trabajador; la discrepancia queda registrada.'), source: 'L3 art. 4.b', kinds: ['draft', 'design'], where: { label: tKey('Solicitudes de corrección'), to: '/correcciones' }, demo: tKey('Propuesta de la empresa a Andrés Ferrer pendiente de su conformidad.') },
  { id: 'R27', text: tKey('Modalidad presencial o a distancia y naturaleza de las horas.'), source: 'L3 art. 3', kinds: ['draft', 'design'], where: { label: tKey('Mi jornada'), to: '/mi-jornada' }, demo: tKey('Campo «Modalidad» opcional, preparado para el proyecto de real decreto.') },
  { id: 'R28', text: tKey('La representación accede con datos minimizados.'), source: 'L3 art. 6.2 · L6 art. 5.1.c', kinds: ['draft', 'legal'], where: { label: tKey('Informes y exportaciones'), to: '/informes' }, demo: tKey('Con Andrés Ferrer, las exportaciones omiten columnas personales y quedan marcadas como minimizadas.') },
  { id: 'R29', text: tKey('Ausencias con categorías, conflictos de calendario, autoridad de aprobación y saldos aprobados.'), source: 'BRD TIM-05', kinds: ['brd'], where: { label: tKey('Ausencias'), to: '/ausencias' }, demo: tKey('Al aprobar se muestran los conflictos; aprobar nunca crea asistencia.') },
  { id: 'R30', text: tKey('Cierre y exportación con las incidencias sin resolver declaradas; exportar no es calcular la nómina.'), source: 'BRD TIM-08', kinds: ['brd'], where: { label: tKey('Estado de cierre de periodos'), to: '/informes?informe=cierre' }, demo: tKey('El cierre exige confirmar los elementos abiertos; cada exportación los declara.') },
  { id: 'R31', text: tKey('Aislamiento entre empresas, permisos por rol y acción, auditoría de solo inserción y reglas con fecha de efecto.'), source: 'BRD PLT-02/03/06/07, SEC-01/05, AC-PLT-01/03', kinds: ['brd'], where: { label: tKey('Auditoría'), to: '/auditoria' }, demo: tKey('Con Iker (Ibaigane) no se ven datos de Levante; la auditoría está encadenada.') },
  { id: 'R32', text: tKey('Fichaje sin conexión y evidencias de ubicación solo tras revisión.'), source: 'BRD TIM-09 (P1)', kinds: ['deferred'], where: null, demo: tKey('Fuera del alcance del prototipo.') },
];

interface Scenario {
  id: string;
  title: string;
  requirement: string;
  users: string[];
  steps: string[];
  test: string;
}

/** BRD acceptance scenarios and how to demonstrate them (docs/02 §6–7). */
const SCENARIOS: Scenario[] = [
  {
    id: 'AC-TIM-01',
    title: tKey('Salida olvidada'),
    requirement: 'TIM-02, TIM-04',
    users: ['usr_pablo', 'usr_elena'],
    steps: [
      tKey('Entre como Pablo Ruiz y abra «Registros horarios»: el registro sin salida aparece como «Incompleto», no se completa solo.'),
      tKey('Abra el registro y pulse «Solicitar corrección»: indique la hora de salida y una explicación.'),
      tKey('Entre como Elena Navarro (su supervisora) y apruebe la solicitud en «Solicitudes de corrección».'),
      tKey('El detalle muestra los valores original, solicitado y aprobado; la incidencia queda resuelta por cambio en los datos.'),
    ],
    test: 'shows a forgotten clock-out as incomplete, not completed (AC-TIM-01)',
  },
  {
    id: 'AC-TIM-02',
    title: tKey('Turno nocturno durante el cambio de hora'),
    requirement: 'TIM-02',
    users: ['usr_sergio', 'usr_javier'],
    steps: [
      tKey('Entre como Sergio Llopis (o Javier) y abra «Registros horarios» con fechas del 28 al 29/03/2026.'),
      tKey('Abra la sesión nocturna: la duración es de siete horas reales aunque el reloj saltó una hora.'),
      tKey('Pase el cursor por las horas: la ayuda muestra el instante UTC y el desfase de cada extremo.'),
    ],
    test: 'computes the real elapsed time of an overnight shift across the spring DST change',
  },
  {
    id: 'AC-TIM-03',
    title: tKey('Resumen mensual de tiempo parcial'),
    requirement: 'TIM-06',
    users: ['usr_lucia', 'usr_rosa'],
    steps: [
      tKey('Entre como Lucía Martínez (o Rosa Bellver, asesoría) y abra «Informes y exportaciones».'),
      tKey('Elija «Resumen mensual tiempo parcial» y un mes cerrado.'),
      tKey('Compruebe el detalle día a día, el total mensual, la versión, la fecha de generación y las incidencias abiertas.'),
      tKey('Exporte en CSV: los metadatos declaran las incidencias abiertas.'),
    ],
    test: 'produces the part-time monthly summary with version and date (AC-TIM-03)',
  },
  {
    id: 'AC-TIM-04',
    title: tKey('Control de conservación'),
    requirement: 'TIM-07',
    users: ['usr_javier'],
    steps: [
      tKey('Entre como Javier Ortega (RR. HH.) y abra la ficha de Teresa Vidal en «Equipo» (baja el 30/06/2025).'),
      tKey('Abra su registro del 05/10/2023 y solicite eliminarlo.'),
      tKey('La eliminación se bloquea hasta el fin del plazo de cuatro años y la decisión aparece en «Auditoría».'),
    ],
    test: 'blocks deleting a three-year-old record of a former employee and records the decision (AC-TIM-04)',
  },
  {
    id: 'AC-PLT-01',
    title: tKey('Aislamiento entre empresas'),
    requirement: 'PLT-01, SEC-01',
    users: ['usr_iker'],
    steps: [
      tKey('Entre como Iker Etxeberria (Instalaciones Ibaigane).'),
      tKey('Solo verá empleados, registros y auditoría de Ibaigane.'),
      tKey('Abra la dirección de un registro de Levante: aparece «Registro no disponible», igual que para un registro inexistente.'),
    ],
    test: 'refuses another company record as "not found"',
  },
  {
    id: 'AC-PLT-03',
    title: tKey('Reglas con fecha de efecto, nunca retroactivas'),
    requirement: 'PLT-07',
    users: ['usr_javier'],
    steps: [
      tKey('Entre como Javier Ortega y abra «Turnos y horarios» → políticas.'),
      tKey('La política de limpieza v2 rige desde el día 1 del mes actual; la v1 sigue aplicándose a los registros anteriores.'),
      tKey('Abra un registro de limpieza del mes pasado: muestra la versión de política aplicada.'),
      tKey('Una nueva versión solo admite fechas de efecto de hoy en adelante.'),
    ],
    test: 'a new policy version is never retroactive',
  },
];

interface DemoUser {
  userId: string;
  companyId: string;
  roles: string;
  show: string;
}

/** docs/02 §7. */
const DEMO_USERS: DemoUser[] = [
  { userId: 'usr_javier', companyId: 'cmp_levante', roles: tKey('RR. HH. + empleado'), show: tKey('Configuración, revisión de empresa, propuestas y cierre de periodos.') },
  { userId: 'usr_laura', companyId: 'cmp_levante', roles: tKey('Propietaria'), show: tKey('Visión de la empresa sin el detalle de ausencias sensibles.') },
  { userId: 'usr_elena', companyId: 'cmp_levante', roles: tKey('Supervisora (técnicos) + empleada'), show: tKey('Revisión del equipo y planificación de turnos.') },
  { userId: 'usr_amparo', companyId: 'cmp_levante', roles: tKey('Supervisora (limpieza) + empleada'), show: tKey('Ausencias y correcciones del equipo de limpieza.') },
  { userId: 'usr_pablo', companyId: 'cmp_levante', roles: tKey('Empleado'), show: tKey('Salida olvidada (AC-TIM-01); solo sus propios registros.') },
  { userId: 'usr_lucia', companyId: 'cmp_levante', roles: tKey('Empleada a tiempo parcial, dos centros'), show: tKey('Escenario del BRD; intento «No registrado»; resumen de tiempo parcial.') },
  { userId: 'usr_sergio', companyId: 'cmp_levante', roles: tKey('Empleado'), show: tKey('Turnos nocturnos, incluida la noche del cambio de hora.') },
  { userId: 'usr_andres', companyId: 'cmp_levante', roles: tKey('Empleado + representante (hasta 14/05/2028)'), show: tKey('Acceso minimizado de la representación; propuesta pendiente de su conformidad.') },
  { userId: 'usr_rosa', companyId: 'cmp_levante', roles: tKey('Asesoría laboral (mandato hasta 31/03/2027)'), show: tKey('Resúmenes y exportaciones, sin administración.') },
  { userId: 'usr_nuria', companyId: 'cmp_levante', roles: tKey('Asesoría laboral, mandato finalizado el 31/03/2026'), show: tKey('Acceso denegado.') },
  { userId: 'usr_iker', companyId: 'cmp_ibaigane', roles: tKey('Propietario + RR. HH.'), show: tKey('Aislamiento entre empresas.') },
];

interface Source {
  id: string;
  title: string;
  url: string;
  note: string;
}

/** docs/01 section B. */
const SOURCES: Source[] = [
  { id: 'L1', title: tKey('Real Decreto Legislativo 2/2015, Estatuto de los Trabajadores'), url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430', note: tKey('Arts. 12.4.c, 34, 35, 36, 37 y 38.') },
  { id: 'L2', title: tKey('Ley 4/2026, de 1 de octubre, disposición final décima'), url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20528', note: tKey('Modifica el art. 37.6 ET; en vigor el 23/10/2026.') },
  { id: 'L3', title: tKey('Proyecto de Real Decreto de registro de jornada (Ministerio de Trabajo, 2025)'), url: 'https://expinterweb.mites.gob.es/participa/listado/download/6cb63e79-48a8-4e99-9784-3a0b26ae6106', note: tKey('Solo borrador: no publicado en el BOE a 12/10/2026. Revisar antes del lanzamiento.') },
  { id: 'L4', title: tKey('Directiva 2003/88/CE (ordenación del tiempo de trabajo)'), url: 'https://eur-lex.europa.eu/legal-content/ES/TXT/?uri=CELEX:32003L0088', note: tKey('Descanso diario, pausas, descanso semanal y vacaciones.') },
  { id: 'L5', title: tKey('TJUE, sentencia de 14/05/2019, C-55/18 (CCOO / Deutsche Bank)'), url: 'https://curia.europa.eu/juris/liste.jsf?num=C-55/18', note: tKey('Sistema objetivo, fiable y accesible.') },
  { id: 'L6', title: tKey('Reglamento (UE) 2016/679 (RGPD)'), url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', note: tKey('Minimización, categorías especiales y privacidad desde el diseño.') },
  { id: 'L7', title: tKey('Ley Orgánica 3/2018 (LOPDGDD), arts. 87–91'), url: 'https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673', note: tKey('Desconexión digital y geolocalización.') },
  { id: 'L8', title: tKey('AEPD, guía sobre control de presencia con sistemas biométricos (2023)'), url: 'https://www.aepd.es/guias/guia-control-presencia-biometrico.pdf', note: tKey('Tratamiento de alto riesgo; el consentimiento no es base válida en el empleo.') },
  { id: 'L9', title: tKey('Real Decreto 1060/2022 (gestión de la incapacidad temporal)'), url: 'https://www.boe.es/buscar/doc.php?id=BOE-A-2023-160', note: tKey('Desde el 01/04/2023 la persona trabajadora no entrega los partes a la empresa.') },
  { id: 'L10', title: tKey('Resolución de 17/10/2025, fiestas laborales 2026'), url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-21667', note: tKey('Calendario de festivos de 2026.') },
  { id: 'L11', title: tKey('Orden PCM/186/2022 (horario de verano 2022–2026)'), url: 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2022-4026', note: tKey('Cambios de hora del 29/03/2026 y del 25/10/2026.') },
  { id: 'L12', title: 'Ministerio de Trabajo, Guía sobre el registro de jornada (2019)', url: 'https://www.mites.gob.es/ficheros/ministerio/GuiaRegistroJornada.pdf', note: tKey('Guía oficial (contenido contrastado con citas secundarias).') },
];

/** docs/01 section E. */
const REVIEW_ITEMS: { id: string; text: string }[] = [
  { id: 'P1', text: tKey('Convenio colectivo aplicable a cada empresa de demostración: retribución de pausas, máximo diario, asuntos propios y vacaciones.') },
  { id: 'P2', text: tKey('Si la pausa de 15 minutos es retribuida según ese convenio.') },
  { id: 'P3', text: tKey('Clasificación de los trabajadores nocturnos y sus pluses.') },
  { id: 'P4', text: tKey('Horas extraordinarias frente a complementarias en contratos a tiempo parcial (pactos del art. 12.5).') },
  { id: 'P5', text: tKey('Saldos de ausencias: cómputo de vacaciones en días naturales o laborables y arrastre.') },
  { id: 'P6', text: tKey('Situación y contenido final del real decreto de registro digital antes del lanzamiento.') },
  { id: 'P7', text: tKey('Alcance del acceso de la representación y seudonimización.') },
  { id: 'P8', text: tKey('Conservación más allá de cuatro años en caso de litigio o inspección (bloqueos legales).') },
];

/** Automated tests (src/*.test.ts), grouped by file. Names are code identifiers (English). */
const TESTS: { file: string; names: string[] }[] = [
  {
    file: 'src/domain/domain.test.ts',
    names: [
      'reports DST gaps and ambiguous hours in Europe/Madrid',
      'computes the real elapsed time of an overnight shift across the spring DST change',
      'keeps planned shifts and actual sessions separate',
      'shows a forgotten clock-out as incomplete, not completed (AC-TIM-01)',
      'applies an approved correction without touching the original events',
      'selects the policy version in force on the work date (no retroactive change)',
      'detects the seeded anomalies from data',
      'never seeds attendance on approved full-day absences',
      'is deterministic for the same anchor',
    ],
  },
  {
    file: 'src/acceptance.test.ts',
    names: [
      'records clock-in, breaks and clock-out as persisted events with receipts',
      'never duplicates an event for a repeated click and rejects impossible transitions',
      'rejects clock-out without an open session',
      'shows "No registrado" on a simulated failure: no event, a failed attempt and a correction route',
      'blocks deleting a three-year-old record of a former employee and records the decision (AC-TIM-04)',
      'keeps the original, requested and approved values and notifies the employee',
      'refuses unauthorised and self approval',
      'requires a rejection reason and an explanation, validates values and prevents parallel requests',
      'cannot correct another employee as an employee',
      'company proposals need the employee agreement or a recorded disagreement',
      'blocks corrections inside a closed period until it is reopened',
      'validates dates, overlaps and partial days',
      'approval requires authority, acknowledges conflicts and never creates attendance',
      'rejection requires a reason; withdraw and traceable cancellation keep history',
      'registers sick leave without approval or medical data and masks it for supervisors',
      'shows a balance only for adviser-approved allowances',
      'scopes records by role',
      'refuses another company record as "not found"',
      'gives representatives minimised exports',
      'exports exactly the filtered rows and discloses open exceptions',
      'closing a period requires acknowledging open items (AC-PLT-04 spirit)',
      'produces the part-time monthly summary with version and date (AC-TIM-03)',
      'a planned shift never becomes actual time and DST gaps are rejected',
      'a new policy version is never retroactive',
      'chains audit events and survives a reload; reset restores the seed',
    ],
  },
  { file: 'src/domain/perf.test.ts', names: ['stays well under the localStorage quota and detects anomalies quickly'] },
  {
    file: 'src/i18n/*.test.ts',
    names: [
      'has an English entry for every literal t() key in the source',
      'leaves no untranslated literal text in JSX',
      'every label, message, reason, summary and reference text',
    ],
  },
];

export function RequirementsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Applicability | ''>('');
  const reqs = useMemo(() => (kind ? REQUIREMENTS.filter((r) => r.kinds.includes(kind)) : REQUIREMENTS), [kind]);
  const userName = (id: string) => ctx.db.users.find((u) => u.id === id)?.name ?? id;
  const companyName = (id: string) => ctx.db.companies.find((c) => c.id === id)?.tradeName ?? id;
  const enter = (u: DemoUser) => {
    switchIdentity(u.userId, u.companyId);
    navigate('/');
  };
  const isCurrent = (u: DemoUser) => ctx.session.userId === u.userId && ctx.session.companyId === u.companyId;
  const demoUser = (id: string) => DEMO_USERS.find((u) => u.userId === id);

  return (
    <>
      <PageHeader title={t('Requisitos y pruebas')} subtitle={t('Guía de demostración: de cada requisito a la pantalla donde se ve y a la prueba automática que lo comprueba.')} />
      <div className="stack-lg">
        <Callout tone="warning" icon={FlaskConical} title={t('Prototipo funcional con datos de demostración')}>
          {t('No es asesoramiento jurídico ni certifica el cumplimiento de ninguna norma. Los elementos marcados «Revisión profesional» deben confirmarse con una asesoría laboral antes de un uso real, y el proyecto de real decreto no se presenta como obligación.')}
        </Callout>

        <Card
          flush
          title={<h2 className="row"><Scale size={16} aria-hidden /> {t('Mapa de requisitos')}</h2>}
          actions={
            <div className="field control-inline-field">
              <label htmlFor="rq-kind">{t('Aplicabilidad')}</label>
              <select id="rq-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as Applicability | '')}>
                <option value="">{t('Todas')}</option>
                {(Object.keys(APPLICABILITY) as Applicability[]).map((k) => <option key={k} value={k}>{t(APPLICABILITY[k].label)}</option>)}
              </select>
            </div>
          }
        >
          <div className="control-legend">
            {(Object.keys(APPLICABILITY) as Applicability[]).map((k) => (
              <span key={k} className="row small" style={{ gap: 6 }}>
                <Badge tone={APPLICABILITY[k].tone} icon={false}>{t(APPLICABILITY[k].label)}</Badge>
                <span className="muted">{t(APPLICABILITY[k].help)}</span>
              </span>
            ))}
          </div>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Requisitos, fuente, aplicabilidad, pantalla y forma de demostrarlo')}</caption>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('Requisito')}</th>
                  <th>{t('Fuente')}</th>
                  <th>{t('Aplicabilidad')}</th>
                  <th>{t('Dónde verlo')}</th>
                  <th>{t('Cómo demostrarlo')}</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td className="strong nowrap">{r.id}</td>
                    <td className="small control-req-text">{t(r.text)}</td>
                    <td className="tiny control-nowrap-md">{r.source}</td>
                    <td>
                      <span className="status-stack">
                        {r.kinds.map((k) => (
                          <Badge key={k} tone={APPLICABILITY[k].tone} icon={false} title={t(APPLICABILITY[k].help)}>{t(APPLICABILITY[k].label)}</Badge>
                        ))}
                      </span>
                    </td>
                    <td className="small">{r.where ? <Link to={r.where.to}>{t(r.where.label)}</Link> : <span className="muted">—</span>}</td>
                    <td className="small control-req-text">{t(r.demo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={<h2 className="row"><BookCheck size={16} aria-hidden /> {t('Escenarios de aceptación del BRD')}</h2>}>
          <div className="grid-2">
            {SCENARIOS.map((s) => (
              <article key={s.id} className="control-scenario stack-sm" aria-labelledby={`sc-${s.id}`}>
                <div className="row between" style={{ flexWrap: 'wrap' }}>
                  <h3 id={`sc-${s.id}`} className="control-h3">
                    <span className="tag">{s.id}</span> {t(s.title)}
                  </h3>
                  <span className="tiny muted">{s.requirement}</span>
                </div>
                <div className="small strong">{t('Cómo demostrarlo')}</div>
                <ol className="small control-steps">
                  {s.steps.map((step, i) => <li key={i}>{t(step)}</li>)}
                </ol>
                <div className="row-wrap">
                  {s.users.map((id) => {
                    const u = demoUser(id);
                    return u ? (
                      <Button key={id} size="sm" icon={LogIn} disabled={isCurrent(u)} onClick={() => enter(u)}>
                        {isCurrent(u) ? t('Sesión actual: {name}', { name: userName(id) }) : t('Entrar como {name}', { name: userName(id) })}
                      </Button>
                    ) : null;
                  })}
                </div>
                <div className="tiny muted">
                  {t('Prueba automática')}: <code>{s.test}</code>
                </div>
              </article>
            ))}
          </div>
        </Card>

        <Card flush title={<h2 className="row"><Users size={16} aria-hidden /> {t('Usuarios de demostración')}</h2>} footer={<span className="tiny muted">{t('El cambio de usuario es una función de demostración y queda registrado en la auditoría de la empresa de destino.')}</span>}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Usuario')}</th>
                  <th>{t('Empresa')}</th>
                  <th>{t('Roles')}</th>
                  <th>{t('Para mostrar')}</th>
                  <th>{t('Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_USERS.map((u) => (
                  <tr key={`${u.userId}-${u.companyId}`}>
                    <td className="strong">{userName(u.userId)}</td>
                    <td className="small">{companyName(u.companyId)}</td>
                    <td className="small">{t(u.roles)}</td>
                    <td className="small">{t(u.show)}</td>
                    <td>
                      {isCurrent(u) ? (
                        <Badge tone="success">{t('Sesión actual')}</Badge>
                      ) : (
                        <Button size="sm" icon={LogIn} onClick={() => enter(u)} aria-label={t('Entrar como {name}', { name: userName(u.userId) })}>
                          {t('Entrar')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid-2">
          <Card title={t('Fuentes oficiales consultadas')}>
            <ul className="control-sources">
              {SOURCES.map((s) => (
                <li key={s.id} id={`fuente-${s.id}`}>
                  <span className="tag">{s.id}</span>{' '}
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {t(s.title)} <ExternalLink size={12} aria-hidden />
                    <span className="sr-only"> ({t('se abre en una pestaña nueva')})</span>
                  </a>
                  <div className="tiny muted">{t(s.note)}</div>
                </li>
              ))}
            </ul>
            <p className="tiny muted">{t('Consultadas el 12/10/2026. BRD: documento de requisitos de negocio ES-SME-BRD-001 v1.0.')}</p>
          </Card>
          <div className="stack">
            <Card title={t('Pendiente de revisión profesional')}>
              <ul className="control-sources">
                {REVIEW_ITEMS.map((p) => (
                  <li key={p.id}>
                    <span className="tag">{p.id}</span> <span className="small">{t(p.text)}</span>
                  </li>
                ))}
              </ul>
              <p className="tiny muted">{t('Debe confirmarlo una persona graduada social o abogada laboralista antes de un uso real.')}</p>
            </Card>
            <Card title={<h2 className="row"><TestTube2 size={16} aria-hidden /> {t('Pruebas automáticas')}</h2>}>
              <p className="small">
                {t('Ejecútelas desde la carpeta del frontend con')} <code>npm test</code>.
              </p>
              {TESTS.map((g) => (
                <details key={g.file} className="control-tests">
                  <summary className="small strong">
                    <code>{g.file}</code> · {t('{n} pruebas', { n: g.names.length })}
                  </summary>
                  <ul className="tiny">
                    {g.names.map((n) => <li key={n}><code>{n}</code></li>)}
                  </ul>
                </details>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
