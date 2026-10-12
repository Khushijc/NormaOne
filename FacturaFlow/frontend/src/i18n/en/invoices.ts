/** English entries for the invoices area. Keys are the Spanish source text. */
export const invoices: Record<string, string> = {
  // Reused from other parts with the same meaning (not redefined here): Cliente, Total, Serie, Número,
  // Vencimiento, Notas, Nombre, Identificación, Domicilio, Datos, Intento, Resultado, Solicitada,
  // Conciliada, Cobrado, Pendiente, Tipo, Método, Referencia, Paso, Historial, Modalidad, 'Sin decidir',
  // 'Sin operaciones', 'Clave de operación', 'Registrar cobro', 'Recordatorios retenidos', Enviada, Entregada.

  // ── Invoice detail: header and actions ──
  'Rectificativa aprobada (sin número) · {customer}': 'Approved corrective invoice (no number) · {customer}',
  'Rectificativa en borrador · {customer}': 'Draft corrective invoice · {customer}',
  'Factura aprobada (sin número) · {customer}': 'Approved invoice (no number) · {customer}',
  'Factura en borrador · {customer}': 'Draft invoice · {customer}',
  'Vista previa': 'Preview',
  'Solicitar aprobación': 'Request approval',
  Devolver: 'Return',
  'Control interno: debe aprobar otra persona': 'Internal control: someone else must approve',
  'Revocar aprobación': 'Revoke approval',
  'Conciliar operación': 'Reconcile operation',
  'Corregir…': 'Correct…',
  'Factura ordinaria': 'Ordinary invoice',
  Líquido: 'Net payable',

  // ── Invoice detail: callouts ──
  'Pendiente de aprobación': 'Awaiting approval',
  'Solicitada por {name} el': 'Requested by {name} on',
  'Comentario:': 'Comment:',
  'Usted es el autor: la aprobación debe hacerla otra persona autorizada (control interno configurable).':
    'You are the author: approval must be given by another authorised person (configurable internal control).',
  'Devuelta para corrección': 'Returned for correction',
  'Emisión con resultado incierto — pendiente de conciliación': 'Issue with uncertain result — pending reconciliation',
  // "El intento {n} (clave <key>, número reservado <number>) no obtuvo respuesta. …" is rendered in fragments.
  'El intento {n} (clave': 'Attempt {n} (key',
  'número reservado': 'reserved number',
  'no obtuvo respuesta. Para no duplicar la factura, la emisión está bloqueada hasta consultar al proveedor por la clave de operación.':
    'received no response. To avoid duplicating the invoice, issuing is blocked until the provider has been queried using the operation key.',
  'La factura no supera la validación': 'The invoice does not pass validation',
  'Rectifica la factura {number}': 'Corrects invoice {number}',
  'por sustitución': 'by substitution',
  'por diferencias': 'by differences',
  'Motivo:': 'Reason:',
  'Ver factura original': 'View original invoice',
  'Esta factura tiene rectificativas vinculadas': 'This invoice has linked corrective invoices',
  'Rectificativa en borrador': 'Draft corrective invoice',
  emitida: 'issued',
  'en preparación': 'in preparation',
  'El contenido de esta factura se conserva sin cambios.': 'The content of this invoice is kept unchanged.',

  // ── Invoice detail: tabs and summary ──
  'Detalle de la factura': 'Invoice details',
  Resumen: 'Summary',
  Envíos: 'Deliveries',
  Líneas: 'Lines',
  'Cant.': 'Qty',
  Precio: 'Price',
  'Dto.': 'Disc.',
  Cuota: 'Tax amount',
  'Retención IRPF {pct} · líquido a cobrar': 'IRPF withholding {pct} · net amount receivable',
  'Menciones obligatorias que figurarán en la factura': 'Mandatory mentions that will appear on the invoice',
  'Se asigna al emitir': 'Assigned on issue',
  Expedición: 'Issue date',
  Operación: 'Operation date',
  'Igual a expedición': 'Same as issue date',
  Condiciones: 'Terms',
  'Preparada por': 'Prepared by',
  'Aprobada por': 'Approved by',
  'Emitida por': 'Issued by',
  Destinatario: 'Recipient',
  'Copia congelada en el momento de la emisión: los cambios posteriores en la ficha del cliente no alteran la factura.':
    'Copy frozen at the time of issue: later changes to the customer record do not alter the invoice.',

  // ── Invoice detail: fiscal tab ──
  'Subsanar y reenviar': 'Correct and resubmit',
  'ID en el proveedor': 'Provider ID',
  'ID de registro': 'Record ID',
  Huella: 'Fingerprint',
  '(demostración; la huella real SHA-256 la calcula el SIF del proveedor)': "(demo; the real SHA-256 fingerprint is calculated by the provider's SIF)",
  Componente: 'Component',
  'declaración responsable disponible (demo)': 'responsible declaration (declaración responsable) available (demo)',
  'sin declaración': 'no declaration',
  'Operaciones con el proveedor': 'Provider operations',
  'La factura todavía no se ha enviado al proveedor.': 'The invoice has not been sent to the provider yet.',
  Respuesta: 'Response',
  AceptadoConErrores: 'Accepted with errors',
  'Vista del registro (ilustrativa)': 'Record view (illustrative)',
  'Estructura inspirada en el registro de alta de la Orden HAC/1177/2024 para identificar los datos que necesitará la integración real. No es un envío válido.':
    'Structure inspired by the registration record (registro de alta) in Orden HAC/1177/2024, to identify the data the real integration will need. It is not a valid submission.',
  '(se asigna al emitir)': '(assigned on issue)',

  // ── Invoice detail: deliveries tab ──
  'Envíos e intercambio': 'Deliveries and exchange',
  'Reintentar envío': 'Retry delivery',
  'El último envío falló': 'The last delivery failed',
  'Revise el correo del cliente o use otro canal. El fallo permanece visible hasta que se resuelva.':
    "Check the customer's email address or use another channel. The failure remains visible until it is resolved.",
  'Sin envíos': 'No deliveries',
  'La factura emitida todavía no se ha enviado al cliente.': 'The issued invoice has not been sent to the customer yet.',
  'Solo se envían facturas emitidas.': 'Only issued invoices are sent.',
  Canal: 'Channel',
  Fallida: 'Failed',
  Aceptada: 'Accepted',
  Rechazada: 'Rejected',
  'La aceptación o rechazo comercial y la comunicación del pago forman parte de la factura electrónica B2B (RD 238/2026, arts. 10 y 12). Requiere un conector validado (FIN-09, condicional) y no está disponible en este prototipo.':
    'Commercial acceptance or rejection and payment notification are part of B2B electronic invoicing (RD 238/2026, arts. 10 and 12). This requires a validated connector (FIN-09, conditional) and is not available in this prototype.',

  // ── Invoice detail: collections tab ──
  'Sin cobro asociado': 'No associated payment',
  'El importe de la rectificativa se compensa en el pendiente de la factura original.':
    "The corrective invoice amount is offset against the original invoice's outstanding balance.",
  'Vence en {n} días': 'Due in {n} days',
  'Información sobre demora (Ley 3/2004) — no se factura automáticamente': 'Late-payment information (Ley 3/2004) — not invoiced automatically',
  'Interés legal de demora vigente: {rate} anual. Estimación a hoy: {amount} + {fee} de compensación por costes de cobro. Reclamarlo es una decisión de la empresa.':
    "Current statutory late-payment interest: {rate} per year. Estimate as of today: {amount} + {fee} compensation for collection costs. Whether to claim it is the company's decision.",
  'Cobros registrados': 'Recorded payments',
  'Recordatorio entregado (simulado)': 'Reminder delivered (simulated)',
  'El recordatorio falló (simulado)': 'The reminder failed (simulated)',
  'Enviar recordatorio': 'Send reminder',
  'Abrir disputa': 'Open dispute',
  'Sin cobros': 'No payments',
  'Registre los cobros con su referencia bancaria. El envío o la entrega no implican cobro.':
    'Record payments with their bank reference. Sending or delivery does not imply payment.',
  Registrado: 'Recorded',
  'Resolución:': 'Resolution:',
  'Historial de auditoría': 'Audit history',

  // ── Invoice detail: confirmation dialogs ──
  'Se notificará a las personas con autoridad de aprobación.': 'People with approval authority will be notified.',
  'Comentario para el aprobador (opcional)': 'Comment for the approver (optional)',
  Solicitar: 'Request',
  'Aprobar factura': 'Approve invoice',
  'Confirma que ha revisado cliente, líneas, tratamiento fiscal y totales ({total}). Aprobar no emite la factura.':
    'Confirm that you have reviewed the customer, lines, tax treatment and totals ({total}). Approving does not issue the invoice.',
  'Existen {n} aviso(s) que quedarán registrados como aceptados.': 'There are {n} warning(s) that will be recorded as accepted.',
  'Devolver al autor': 'Return to author',
  'Qué debe corregirse': 'What needs correcting',
  'Borrador devuelto': 'Draft returned',
  'La factura vuelve a borrador y podrá editarse.': 'The invoice goes back to draft and can be edited.',
  'El borrador no tiene número ni efectos fiscales. La eliminación quedará registrada en la auditoría.':
    'The draft has no number and no tax effect. The deletion will be recorded in the audit log.',
  'Subsanar y reenviar el registro': 'Correct and resubmit the record',
  'Se enviará un nuevo registro (subsanación) con una clave de operación nueva. El resultado depende del escenario simulado configurado en Integración fiscal.':
    'A new record (subsanación) will be sent with a new operation key. The result depends on the simulated scenario configured in Fiscal integration.',
  'Corrección realizada': 'Correction made',
  Reenviar: 'Resubmit',
  Anular: 'Reverse',
  'Anular cobro': 'Reverse payment',
  'Se registrará un evento de anulación vinculado; el cobro original se conserva en el historial.':
    'A linked reversal event will be recorded; the original payment is kept in the history.',
  'Resolver disputa': 'Resolve dispute',
  'Resolución (p. ej. rectificativa emitida, cliente acepta)': 'Resolution (e.g. corrective invoice issued, customer accepts)',
  Resolver: 'Resolve',

  // ── Issue dialog ──
  'Factura emitida y registro aceptado (simulado)': 'Invoice issued and record accepted (simulated)',
  'Emitida: registro aceptado con errores': 'Issued: record accepted with errors',
  'Emitida, pero el registro fiscal fue rechazado': 'Issued, but the fiscal record was rejected',
  'Resultado incierto: no reintente, concilie': 'Uncertain result: do not retry, reconcile',
  'No procesada': 'Not processed',
  'Proveedor no disponible: no se emitió': 'Provider unavailable: not issued',
  'Emitir factura': 'Issue invoice',
  'La emisión se realiza a través del proveedor fiscal SIMULADO. No hay conexión con la AEAT.':
    'Issuing goes through the SIMULATED fiscal provider. There is no connection to the AEAT.',
  'Emitir {number}': 'Issue {number}',
  'Número a asignar': 'Number to be assigned',
  '(reservado en el intento anterior; se reutiliza)': '(reserved in the previous attempt; it is reused)',
  'Clave de idempotencia': 'Idempotency key',
  'Respuesta del proveedor simulado': 'Simulated provider response',
  'Control de demostración para probar éxito, rechazo, tiempo de espera y caída del proveedor. Se aplica solo a este envío.':
    'Demo control for testing success, rejection, timeout and provider outage. It applies to this submission only.',
  'Tras emitir, la factura no podrá modificarse ni eliminarse: cualquier corrección se hará con una factura rectificativa. Un PDF o una respuesta correcta del proveedor no implican entrega ni cobro.':
    'Once issued, the invoice cannot be modified or deleted: any correction must be made with a corrective invoice. A PDF or a successful provider response does not imply delivery or payment.',
  'Número:': 'Number:',
  'El botón «Emitir» queda bloqueado hasta conciliar la operación en la pestaña Fiscal o en Integración fiscal. Así se evita emitir dos veces la misma factura.':
    'The "Issue" button stays blocked until the operation is reconciled in the Fiscal tab or in Fiscal integration. This prevents the same invoice from being issued twice.',
  'Se ha creado una excepción asignada al emisor (copia a la propiedad). Corrija y reenvíe desde la pestaña Fiscal.':
    'An exception has been created and assigned to the issuer (copied to the owner). Correct and resubmit from the Fiscal tab.',

  // ── Payment dialog ──
  'Importe no válido (p. ej. 1.234,56).': 'Invalid amount (e.g. 1,234.56).',
  'Cobro registrado: factura cobrada': 'Payment recorded: invoice paid',
  'Cobro parcial registrado': 'Partial payment recorded',
  'Registrar cobro · {number}': 'Record payment · {number}',
  'Pendiente de cobro: {amount}. Un cobro nunca se deduce del envío ni de la emisión: se registra con su justificante.':
    'Outstanding: {amount}. A payment is never inferred from sending or issuing: it is recorded with its supporting evidence.',
  'Fecha de cobro': 'Payment date',
  'Importe (€)': 'Amount (€)',
  'Usar pendiente total': 'Use full outstanding amount',
  'Referencia del movimiento': 'Transaction reference',
  'Nº de transferencia, recibo o ticket.': 'Transfer, receipt or ticket number.',
  'Pagos en efectivo': 'Cash payments',
  'Límite de 1.000 € por operación cuando alguna parte actúa como empresario o profesional, sumando pagos fraccionados (Ley 7/2012, art. 7). Efectivo ya cobrado en esta factura: {cash}; máximo adicional: {max}.':
    'Limit of €1,000 per transaction when either party acts as a business or professional, adding split payments together (Ley 7/2012, art. 7). Cash already collected on this invoice: {cash}; maximum additional amount: {max}.',
  'No se puede registrar': 'Cannot be recorded',

  // ── Dispute dialog ──
  'Abrir disputa · {number}': 'Open dispute · {number}',
  'Motivo de la disputa': 'Reason for the dispute',
  'Retener los recordatorios de cobro mientras la disputa esté abierta': 'Hold payment reminders while the dispute is open',
  'Los recordatorios programados quedarán registrados como suprimidos.': 'Scheduled reminders will be recorded as suppressed.',
  'La disputa no modifica la factura. Si procede corregir importes, emita una rectificativa.':
    'The dispute does not change the invoice. If amounts need correcting, issue a corrective invoice.',

  // ── Send dialog ──
  'Enviar factura · {number}': 'Send invoice · {number}',
  'Correo electrónico con PDF (simulado)': 'Email with PDF (simulated)',
  'Entrega manual registrada': 'Recorded manual delivery',
  'Factura electrónica B2B — no disponible (FIN-09, condicional)': 'B2B electronic invoice — not available (FIN-09, conditional)',
  'Para simular un rebote, use una dirección que contenga «rebote».': 'To simulate a bounce, use an address containing "rebote".',
  'El envío por correo no es una factura electrónica estructurada B2B. Un flujo solo PDF no se considera preparado para la obligación B2B.':
    'Sending by email is not a structured B2B electronic invoice. A PDF-only flow is not considered ready for the B2B obligation.',
  'Entregada. {detail}': 'Delivered. {detail}',
  'Error: {detail}': 'Error: {detail}',

  // ── Correction dialog ──
  'Corregir la factura {number}': 'Correct invoice {number}',
  'Elija la operación adecuada. No son intercambiables.': 'Choose the appropriate operation. They are not interchangeable.',
  'Para errores en el contenido, importes o tipo impositivo, o cambios en la base (RD 1619/2012, art. 15; LIVA art. 80). Se emite un documento nuevo en la serie de rectificativas, vinculado al original. El original no se modifica.':
    'For errors in the content, amounts or tax rate, or changes to the taxable base (RD 1619/2012, art. 15; LIVA art. 80). A new document is issued in the corrective invoice series, linked to the original. The original is not modified.',
  'Crear rectificativa': 'Create corrective invoice',
  'Anulación del registro de facturación': 'Invoicing record cancellation (anulación)',
  'Requiere revisión profesional': 'Requires professional review',
  'Operación del sistema de facturación (registro de anulación, Orden HAC/1177/2024 art. 11) para registros generados por error. No anula la obligación de facturar ni sustituye a una rectificativa. Cuándo procede debe decidirlo el asesor fiscal.':
    'Invoicing system operation (cancellation record, registro de anulación, Orden HAC/1177/2024 art. 11) for records generated in error. It does not cancel the obligation to invoice and does not replace a corrective invoice. When it applies must be decided by the tax adviser.',
  'Solicitar revisión de anulación': 'Request cancellation review',
  'Motivo y contexto para el asesor': 'Reason and context for the adviser',
  'Solicitud enviada a revisión profesional (no se ha anulado nada)': 'Request sent for professional review (nothing has been cancelled)',
  'Cancelar o eliminar la factura': 'Cancel or delete the invoice',
  'No disponible. Una factura expedida no se elimina ni se modifica: se conserva durante el plazo legal y se corrige mediante rectificativa.':
    'Not available. An issued invoice is neither deleted nor modified: it is retained for the legal period and corrected by means of a corrective invoice.',

  // ── invoiceService: errors (BusinessRuleError messages and details) ──
  'La factura está aprobada. Revoque la aprobación para editarla.': 'The invoice is approved. Revoke the approval to edit it.',
  'Las facturas emitidas no se pueden modificar ni eliminar. Use una factura rectificativa.': 'Issued invoices cannot be modified or deleted. Use a corrective invoice.',
  'La serie seleccionada no está activa.': 'The selected series is not active.',
  'Una factura ordinaria no puede usar una serie de rectificativas.': 'An ordinary invoice cannot use a corrective invoice series.',
  'Seleccione una serie ordinaria. Las rectificativas se crean desde la factura original.': 'Select an ordinary series. Corrective invoices are created from the original invoice.',
  'Existe una operación fiscal pendiente de conciliación.': 'There is a fiscal operation pending reconciliation.',
  'Corrija los errores antes de solicitar la aprobación.': 'Correct the errors before requesting approval.',
  'Indique el motivo de la devolución.': 'Enter the reason for returning it.',
  'Control interno: la aprobación debe realizarla una persona distinta del autor del borrador.':
    'Internal control: approval must be given by someone other than the author of the draft.',
  'La factura no supera la validación.': 'The invoice does not pass validation.',
  'Indique el motivo.': 'Enter the reason.',
  'Solo se puede revocar la aprobación de una factura aprobada y no emitida.': 'Approval can only be revoked for an approved invoice that has not been issued.',
  'Hay una operación de emisión pendiente de conciliación: concilie antes de revocar.': 'There is an issue operation pending reconciliation: reconcile before revoking.',
  'Ya existe un intento de emisión con resultado incierto o en curso. Concilie la operación antes de volver a emitir (no se crearán duplicados).':
    'There is already an issue attempt with an uncertain result or in progress. Reconcile the operation before issuing again (no duplicates will be created).',
  'Solo se pueden emitir facturas aprobadas.': 'Only approved invoices can be issued.',
  'La emisión está bloqueada para esta empresa.': 'Issuing is blocked for this company.',
  '{message} — Responsable: {owner}': '{message} — Owner: {owner}',
  'La factura ya no supera la validación (la configuración o el cliente han cambiado).': 'The invoice no longer passes validation (the settings or the customer have changed).',
  'Esta operación ya tiene un resultado definitivo.': 'This operation already has a final result.',
  'Solo se reenvían registros rechazados o aceptados con errores.': 'Only records that were rejected or accepted with errors are resubmitted.',
  'Hay una operación pendiente de conciliación.': 'There is an operation pending reconciliation.',
  'Describa la corrección realizada antes del reenvío.': 'Describe the correction made before resubmitting.',
  'Solo aplica a facturas emitidas.': 'Only applies to issued invoices.',
  'Solo se pueden enviar facturas emitidas.': 'Only issued invoices can be sent.',
  'Correo del destinatario no válido.': "Invalid recipient email address.",
  'Para corregir una rectificativa, rectifique la factura original.': 'To correct a corrective invoice, correct the original invoice.',
  'Solo se pueden rectificar facturas emitidas. Un borrador se edita directamente.': 'Only issued invoices can be corrected. A draft is edited directly.',
  'El motivo de la rectificación es obligatorio.': 'The reason for the correction is required.',
  'Ya existe una rectificativa en preparación para esta factura. Complétela o elimínela antes de crear otra.':
    'A corrective invoice for this invoice is already in preparation. Complete or delete it before creating another.',
  'No hay una serie de rectificativas activa. Configúrela antes de rectificar (RD 1619/2012, art. 6.1.a).':
    'There is no active corrective invoice series. Set one up before correcting (RD 1619/2012, art. 6.1.a).',
  'Las líneas corregidas son idénticas a las originales: no hay nada que rectificar.': 'The corrected lines are identical to the originals: there is nothing to correct.',

  // ── invoiceService: audit summaries and change fields (stored in Spanish) ──
  'Estado documento': 'Document status',
  'Nº de líneas': 'No. of lines',
  'Borrador modificado.': 'Draft modified.',
  'Borrador creado · {total}': 'Draft created · {total}',
  'Borrador eliminado ({total}).': 'Draft deleted ({total}).',
  'Devuelta al autor para corrección.': 'Returned to the author for correction.',
  'Aprobada · {total}': 'Approved · {total}',
  'Aprobada · {total} · {n} aviso(s) aceptado(s)': 'Approved · {total} · {n} warning(s) accepted',
  'Aprobación revocada; vuelve a borrador.': 'Approval revoked; back to draft.',
  'Rectificada por {number}. Contenido original conservado sin cambios.': 'Corrected by {number}. Original content kept unchanged.',
  'Emitida: número {number}.': 'Issued: number {number}.',
  'Emitida: número {number} · ID proveedor {providerId}.': 'Issued: number {number} · provider ID {providerId}.',
  'Emitida: número {number} · el proveedor reconoció la clave (sin duplicado).': 'Issued: number {number} · the provider recognised the key (no duplicate).',
  'Emitida: número {number} · ID proveedor {providerId} · el proveedor reconoció la clave (sin duplicado).':
    'Issued: number {number} · provider ID {providerId} · the provider recognised the key (no duplicate).',
  'Emisión confirmada por conciliación: número {number}.': 'Issue confirmed by reconciliation: number {number}.',
  'Emisión confirmada por conciliación: número {number} · ID proveedor {providerId}.': 'Issue confirmed by reconciliation: number {number} · provider ID {providerId}.',
  'Emisión confirmada por conciliación: número {number} · el proveedor reconoció la clave (sin duplicado).':
    'Issue confirmed by reconciliation: number {number} · the provider recognised the key (no duplicate).',
  'Emisión confirmada por conciliación: número {number} · ID proveedor {providerId} · el proveedor reconoció la clave (sin duplicado).':
    'Issue confirmed by reconciliation: number {number} · provider ID {providerId} · the provider recognised the key (no duplicate).',
  // Fiscal audit summary: "<response code> — <response message> (<error codes>)". Simulated error codes are SIM-xxxx.
  'Correcto — {message}': 'Correct — {message}',
  'AceptadoConErrores — {message}': 'Accepted with errors — {message}',
  'AceptadoConErrores — {message} (SIM-{codes})': 'Accepted with errors — {message} (SIM-{codes})',
  'Incorrecto — {message}': 'Incorrect — {message}',
  'Incorrecto — {message} (SIM-{codes})': 'Incorrect — {message} (SIM-{codes})',
  'Emisión bloqueada por la configuración de aplicabilidad.': 'Issue blocked by the applicability settings.',
  'Intento {n} · clave {key} · número reservado {number} · escenario simulado "{scenario}".':
    'Attempt {n} · key {key} · reserved number {number} · simulated scenario "{scenario}".',
  '{message} El número {number} queda reservado para el reintento con la misma clave.': '{message} Number {number} remains reserved for the retry with the same key.',
  'Conciliación: el proveedor SÍ procesó la clave {key}.': 'Reconciliation: the provider DID process key {key}.',
  'Conciliación: el proveedor NO procesó la clave {key}. Reintento habilitado.': 'Reconciliation: the provider did NOT process key {key}. Retry enabled.',
  'Conciliación: el proveedor no tiene registro de esta clave. Puede reintentarse con la misma clave y número.':
    'Reconciliation: the provider has no record of this key. It can be retried with the same key and number.',
  'El proveedor no procesó la solicitud. Ya puede volver a emitir: se reutilizarán la misma clave y el mismo número.':
    'The provider did not process the request. You can now issue again: the same key and number will be reused.',
  'Reenvío de registro corregido (subsanación) · clave {key}.': 'Corrected record resubmitted (subsanación) · key {key}.',
  'Solicitud de anulación del registro fiscal remitida para revisión profesional ({adviser}). No se ha enviado nada al proveedor.':
    'Fiscal record cancellation (anulación) request referred for professional review ({adviser}). Nothing has been sent to the provider.',
  'Envío por correo a {recipient}.': 'Sent by email to {recipient}.',
  'Envío por entrega manual a {recipient}.': 'Manual delivery to {recipient}.',
  'Rectificativa {code} por sustitución de {number}: {total}.': 'Corrective invoice {code} by substitution of {number}: {total}.',
  'Rectificativa {code} por diferencias de {number}: {total}.': 'Corrective invoice {code} by differences of {number}: {total}.',
  'Rectificativa en preparación. El original no se modifica.': 'Corrective invoice in preparation. The original is not modified.',

  // ── Delivery details (invoiceService) ──
  'Enviada por correo con PDF (simulado).': 'Sent by email with PDF (simulated).',
  'Entrega manual registrada (papel o en mano).': 'Manual delivery recorded (paper or by hand).',
  'Entrega manual registrada.': 'Manual delivery recorded.',

  // ── Simulated fiscal provider (mock/fiscalProvider.ts) and seeded operations ──
  'Registro de facturación aceptado (respuesta SIMULADA; no procede de la AEAT).': 'Invoicing record accepted (SIMULATED response; not from the AEAT).',
  'Registro aceptado con errores que deben subsanarse (SIMULADO).': 'Record accepted with errors that must be corrected (SIMULATED).',
  'Registro no aceptado (SIMULADO). Corrija y reenvíe.': 'Record not accepted (SIMULATED). Correct and resubmit.',
  'Operación ya procesada con esta clave: se devuelve el resultado original. {message}': 'Operation already processed with this key: the original result is returned. {message}',
  'Tiempo de espera agotado sin respuesta del proveedor (simulado). El resultado es incierto: concilie antes de reintentar.':
    'Timed out with no response from the provider (simulated). The result is uncertain: reconcile before retrying.',
  'Proveedor fiscal no disponible (simulado). No se ha generado ningún registro.': 'Fiscal provider unavailable (simulated). No record has been generated.',
  'SIMULADO — Error de validación en los datos del destinatario.': "SIMULATED — Validation error in the recipient's details.",
  'SIMULADO — Descripción de la operación incompleta; subsane en un nuevo registro.': 'SIMULATED — Incomplete description of the operation; correct it in a new record (subsanación).',
  'SIMULADO — La fecha de operación es posterior a la de expedición; revise y subsane.': 'SIMULATED — The operation date is later than the issue date; review and correct (subsanación).',
  'Registro rechazado (SIMULADO).': 'Record rejected (SIMULATED).',
};
