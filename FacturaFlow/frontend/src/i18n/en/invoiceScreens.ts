/** English entries for the invoice list, editor, preview and rectification screens. Keys are the Spanish source text. */
export const invoiceScreens: Record<string, string> = {
  // Shared keys reused from other parts with the same meaning: Documento, Envío, Fiscal, Cobro,
  // Desde, Hasta, Tipo, Revisión, Estados, Pendiente, Modalidad, Tratamiento, 'Nueva factura',
  // 'Nuevo cliente', 'Guardar borrador', 'Borrador guardado', 'Seleccione…', '0,00', 'Total factura'.

  // ── Invoice list ──
  Texto: 'Text',
  Vencidas: 'Overdue',
  Ordinarias: 'Ordinary',
  'Pendiente de aprobación': 'Awaiting approval',
  'Facturas de venta y rectificativas. Documento, registro fiscal, envío y cobro se siguen como estados independientes.':
    'Sales invoices and corrective invoices. Document, fiscal record, delivery and payment are tracked as independent statuses.',
  'Filtros de facturas': 'Invoice filters',
  'Número, cliente, NIF o concepto': 'Number, customer, NIF or description',
  'Solo vencidas': 'Overdue only',
  'Filtros activos': 'Active filters',
  'Quitar filtro {name}': 'Remove filter {name}',
  'Ninguna factura coincide con los filtros': 'No invoices match the filters',
  'Todavía no hay facturas': 'There are no invoices yet',
  'Crear la primera factura': 'Create the first invoice',
  'Modifique o limpie los filtros.': 'Change or clear the filters.',
  'Cree un borrador, solicite su aprobación y emítalo a través del proveedor fiscal simulado.':
    'Create a draft, request its approval and issue it through the simulated fiscal provider.',
  'Rectificativa (borrador)': 'Corrective invoice (draft)',
  'Rectifica {n}': 'Corrects {n}',
  // Small label under a draft's date: the date shown is the creation date.
  creación: 'created',
  '{n} factura en la selección': '{n} invoice in the selection',
  '{n} facturas en la selección': '{n} invoices in the selection',
  'Su rol solo ve facturas emitidas; los borradores internos no se comparten con la gestoría.':
    'Your role only sees issued invoices; internal drafts are not shared with the accountant (gestoría).',

  // ── Invoice editor ──
  'Esta factura no es editable': 'This invoice cannot be edited',
  'Está aprobada. Revoque la aprobación desde el detalle para volver a editarla.':
    'It has been approved. Revoke the approval from the invoice details to edit it again.',
  'Las facturas emitidas no se modifican ni se eliminan: cree una factura rectificativa vinculada.':
    'Issued invoices are not changed or deleted: create a linked corrective invoice.',
  'Volver al detalle': 'Back to details',
  'Aprobación solicitada a las personas autorizadas': 'Approval requested from the authorised people',
  'Editar rectificativa (borrador)': 'Edit corrective invoice (draft)',
  'Editar borrador': 'Edit draft',
  Nueva: 'New',
  'El número se asigna al emitir, desde el contador de la serie, para garantizar la numeración correlativa sin huecos.':
    'The number is assigned on issue, from the series counter, to guarantee consecutive numbering with no gaps.',
  'Guardar y solicitar aprobación': 'Save and request approval',
  'Rectificativa de {n} · {code} · {method}': 'Corrective invoice for {n} · {code} · {method}',
  'por sustitución': 'by substitution',
  'por diferencias': 'by differences',
  'Motivo: {reason}. La factura original no se modifica.': 'Reason: {reason}. The original invoice is not modified.',
  'Datos generales': 'General details',
  'sin NIF': 'no NIF',
  'Próximo número previsto: {n} (se confirma al emitir)': 'Next expected number: {n} (confirmed on issue)',
  'No hay series activas': 'There are no active series',
  'Fecha de operación': 'Operation date',
  'Si difiere de la fecha de expedición (art. 6.1.i).': 'If it differs from the issue date (art. 6.1.i).',
  'Plazo del cliente: {n} días': "Customer's payment terms: {n} days",
  'Condiciones de pago': 'Payment terms',
  'Profesional persona física con cliente empresario/profesional (LIRPF art. 101.5). El 7 % exige declaración del inicio de actividad.':
    'Self-employed professional (individual) invoicing a business or professional customer (LIRPF art. 101.5). The 7% rate requires a declaration of the start of activity.',
  '15 % (general)': '15% (general)',
  '7 % (inicio de actividad)': '7% (start of activity)',
  'Sin retención': 'No withholding',
  Líneas: 'Lines',
  'Añadir línea': 'Add line',
  Cantidad: 'Quantity',
  'Precio unit. (sin IVA)': 'Unit price (excl. VAT)',
  'Dto. %': 'Disc. %',
  'Tratamiento fiscal': 'Tax treatment',
  'Descripción línea {n}': 'Description, line {n}',
  'Cantidad línea {n}': 'Quantity, line {n}',
  'Precio línea {n}': 'Unit price, line {n}',
  'Descuento línea {n}': 'Discount, line {n}',
  'Tratamiento fiscal línea {n}': 'Tax treatment, line {n}',
  'Eliminar línea {n}': 'Delete line {n}',
  'Servicio prestado': 'Service provided',
  'Número no válido': 'Invalid number',
  'Importe no válido (p. ej. 1.234,56)': 'Invalid amount (e.g. 1,234.56)',
  'no soportado': 'not supported',
  'no aprobado': 'not approved',
  'Notas visibles en la factura': 'Notes shown on the invoice',
  'La factura no podrá aprobarse hasta corregir:': 'The invoice cannot be approved until you correct:',
  'Avisos (no bloquean el guardado)': 'Warnings (they do not block saving)',
  Totales: 'Totals',
  'Importe bruto': 'Gross amount',
  Descuentos: 'Discounts',
  'Cuota ({rate})': 'Tax amount ({rate})',
  'Total IVA': 'Total VAT',
  'Retención IRPF ({rate})': 'IRPF withholding ({rate})',
  'Líquido a cobrar': 'Net amount receivable',
  'El IVA se calcula sobre la base agregada de cada tipo y se redondea al céntimo.':
    'VAT is calculated on the aggregate base for each rate and rounded to the cent.',
  // Tax breakdown label for a line whose tax code no longer exists (domain/invoiceCalc.ts).
  'Código desconocido ({code})': 'Unknown code ({code})',

  // ── Invoice preview (page chrome only: the invoice document itself stays in Spanish) ──
  'Imprimir / guardar como PDF': 'Print / save as PDF',
  'Vista generada por el prototipo con datos ficticios. Un PDF no es una factura electrónica estructurada ni prueba de aceptación fiscal, entrega o cobro.':
    'View generated by the prototype with fictitious data. A PDF is not a structured electronic invoice, nor proof of fiscal acceptance, delivery or payment.',
  'El documento de factura se muestra en español, el idioma en que se emite.':
    'The invoice document is shown in Spanish, the language in which it is issued.',
  'Vista previa de la factura': 'Invoice preview',
  'Espacio reservado para el código QR': 'Placeholder for the QR code',

  // ── Rectification (corrective invoice) wizard ──
  // R1–R4 are the AEAT reason codes; the LIVA article references are kept as published.
  'R1 — Error fundado en derecho y causas del art. 80.Uno, Dos y Seis LIVA (p. ej. error de precio, descuento posterior, devolución)':
    'R1 — Error grounded in law and the grounds in art. 80.Uno, Dos and Seis LIVA (e.g. pricing error, subsequent discount, return)',
  'R2 — Art. 80.Tres LIVA (concurso del destinatario)': 'R2 — Art. 80.Tres LIVA (recipient in insolvency proceedings)',
  'R3 — Art. 80.Cuatro LIVA (créditos incobrables)': 'R3 — Art. 80.Cuatro LIVA (bad debts)',
  'R4 — Resto de causas (p. ej. datos identificativos, menciones)': 'R4 — Other grounds (e.g. identification details, mandatory wording)',
  'No rectificable': 'Cannot be corrected',
  'Solo se rectifican facturas ordinarias emitidas.': 'Only issued ordinary invoices can be corrected.',
  'Rectificativa creada como borrador: revísela y solicite su aprobación': 'Corrective invoice created as a draft: review it and request approval',
  Rectificar: 'Correct',
  'Rectificar {n}': 'Correct {n}',
  'Se crea una factura rectificativa nueva, en serie propia y vinculada. La factura original no se modifica ni se elimina.':
    'A new, linked corrective invoice is created in its own series. The original invoice is not changed or deleted.',
  'Crear rectificativa (borrador)': 'Create corrective invoice (draft)',
  'Ya existe una rectificativa en preparación': 'A corrective invoice is already being prepared',
  Ábrala: 'Open it',
  'para completarla o elimínela antes de crear otra.': 'to complete it, or delete it before creating another.',
  'No hay serie de rectificativas activa': 'There is no active corrective invoice series',
  'Configúrela en Configuración → Series (RD 1619/2012, art. 6.1.a).': 'Set it up in Settings → Series (RD 1619/2012, art. 6.1.a).',
  'Plazo de rectificación': 'Time limit for correction',
  'Han pasado más de cuatro años desde el devengo: no puede rectificarse (art. 15.3). Consulte al asesor.':
    'More than four years have passed since the tax point: it can no longer be corrected (art. 15.3). Consult the adviser.',
  'Requiere revisión profesional en casos dudosos': 'Requires professional review in doubtful cases',
  'La causa (R1–R4) y la modalidad tienen efectos fiscales. Ante dudas, consulte a {adviser}. El prototipo no decide la causa aplicable.':
    'The ground (R1–R4) and the method have tax effects. If in doubt, consult {adviser}. The prototype does not decide which ground applies.',
  '1. Causa y modalidad': '1. Ground and method',
  'Causa de rectificación': 'Ground for correction',
  'La rectificativa recoge solo la diferencia, con su signo.': 'The corrective invoice shows only the difference, with its sign.',
  'La rectificativa recoge los importes correctos completos.': 'The corrective invoice shows the full correct amounts.',
  'Por diferencias': 'By differences',
  'Por sustitución': 'By substitution',
  'Motivo detallado': 'Detailed reason',
  'El motivo es obligatorio y queda vinculado al original.': 'The reason is required and is linked to the original.',
  '2. Contenido correcto de la factura': '2. Correct invoice content',
  'Cant.': 'Qty',
  Precio: 'Price',
  'Base original → corregida': 'Base original → corrected',
  Restaurar: 'Restore',
  Quitar: 'Remove',
  '3. Líneas de la rectificativa (vista previa)': '3. Corrective invoice lines (preview)',
  'Sin diferencias respecto a la factura original.': 'No differences from the original invoice.',
  Impacto: 'Impact',
  'Total original': 'Original total',
  'Total correcto': 'Correct total',
  'Total de la rectificativa': 'Corrective invoice total',
  'El cobro pendiente de la factura original se recalcula con la rectificativa (sustituye el importe) cuando esta se emita.':
    'The outstanding balance of the original invoice is recalculated with the corrective invoice (which replaces the amount) once it is issued.',
  'El cobro pendiente de la factura original se recalcula con la rectificativa (suma la diferencia) cuando esta se emita.':
    'The outstanding balance of the original invoice is recalculated with the corrective invoice (which adds the difference) once it is issued.',
};
