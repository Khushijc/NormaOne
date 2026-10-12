import { Database as DbIcon, Download, KeyRound, Plus, RotateCcw, ShieldCheck, UserMinus, UserPlus, Pencil, Clock } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IssueGatePanel } from '../components/invoiceBits';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, DateText, DateTimeText, KV, Modal, PageHeader, SelectField, Tabs, TextAreaField, TextField, useAction, useToast } from '../components/ui';
import { deriveB2bDeadline, deriveSifDeadline, ruleHistory, SUPPORTED_TERRITORIES, TERRITORY_LABEL } from '../domain/applicability';
import { formatDate, isValidISODate, today as realToday } from '../domain/dates';
import { centsToInput, formatEUR, parseAmountToCents } from '../domain/money';
import { isMembershipActive, ROLE_ORDER, ROLES, type Permission } from '../domain/permissions';
import type { ApplicabilityState, FinanceConfig, InvoiceSeries, Membership, RoleId, RuleVersion } from '../domain/types';
import { t } from '../i18n';
import { approveFinanceConfig, inviteUser, recordApplicabilityDecision, revokeMembership, saveSeries, setTaxCodeApproval, updateCollectionPolicy, updateCompany, updateFinanceConfig, updateMembership, type MembershipInput } from '../services/adminService';
import { downloadFile } from '../services/exportService';
import { getDb, resetDemoData, setSession } from '../store/db';
import { isPersistent, KEYS, readRaw } from '../store/storage';
import { useCtx } from '../store/hooks';
import { userName } from '../store/selectors';
import { resetProviderState } from '../services/mock/fiscalProvider';

type TabId = 'empresa' | 'fiscal' | 'series' | 'impuestos' | 'cobros' | 'usuarios' | 'reglas' | 'datos';

export function SettingsPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabId) || 'empresa';
  return (
    <>
      <PageHeader title={t('Configuración')} subtitle={t('{company} · los cambios quedan registrados en la auditoría.', { company: ctx.company.legalName })} />
      {!ctx.can('settings.company') && <div style={{ marginBottom: 12 }}><Callout tone="info">{t('Modo de solo lectura: la configuración la gestiona la propiedad.')}</Callout></div>}
      <Tabs
        label={t('Secciones de configuración')}
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          { id: 'empresa', label: t('Empresa') },
          { id: 'fiscal', label: t('Fiscal y aplicabilidad') },
          { id: 'series', label: t('Series') },
          { id: 'impuestos', label: t('Tipos impositivos') },
          { id: 'cobros', label: t('Cobros y controles') },
          { id: 'usuarios', label: t('Usuarios y permisos') },
          { id: 'reglas', label: t('Reglas y fuentes') },
          { id: 'datos', label: t('Datos de demostración') },
        ]}
      />
      {tab === 'empresa' && <CompanyTab />}
      {tab === 'fiscal' && <FiscalTab />}
      {tab === 'series' && <SeriesTab />}
      {tab === 'impuestos' && <TaxTab />}
      {tab === 'cobros' && <PolicyTab />}
      {tab === 'usuarios' && <UsersTab />}
      {tab === 'reglas' && <RulesTab />}
      {tab === 'datos' && <DataTab />}
    </>
  );
}

function CompanyTab() {
  const ctx = useCtx();
  const c = ctx.company;
  const { runOk, pending } = useAction();
  const [f, setF] = useState({ legalName: c.legalName, tradeName: c.tradeName, activity: c.activity, cnae: c.cnae, employeeCount: String(c.employeeCount), taxAdministration: c.taxAdministration });
  const [reviewer, setReviewer] = useState('');
  const can = ctx.can('settings.company');
  return (
    <div className="grid-main-side">
      <Card title={t('Perfil de la empresa')} footer={can && <div className="row between"><TextField label={t('Revisado por (opcional)')} value={reviewer} onChange={(e) => setReviewer(e.target.value)} hint={t('Persona responsable que confirma el perfil (PLT-01).')} /><Button variant="primary" loading={pending} onClick={() => runOk(() => updateCompany({ ...f, employeeCount: Number(f.employeeCount) }, reviewer || null), t('Perfil guardado'))}>{t('Guardar')}</Button></div>}>
        <div className="form-grid">
          <TextField label={t('Razón social')} required value={f.legalName} disabled={!can} onChange={(e) => setF({ ...f, legalName: e.target.value })} className="span-2" />
          <TextField label={t('Nombre comercial')} value={f.tradeName} disabled={!can} onChange={(e) => setF({ ...f, tradeName: e.target.value })} />
          <TextField label={t('NIF')} value={c.nif} disabled hint={t('Cambiar el NIF implica un nuevo obligado tributario: no editable.')} />
          <TextField label={t('Actividad')} value={f.activity} disabled={!can} onChange={(e) => setF({ ...f, activity: e.target.value })} className="span-2" />
          <TextField label={t('CNAE')} value={f.cnae} disabled={!can} onChange={(e) => setF({ ...f, cnae: e.target.value })} />
          <TextField label={t('Plantilla')} type="number" value={f.employeeCount} disabled={!can} onChange={(e) => setF({ ...f, employeeCount: e.target.value })} hint={t('Segmento de lanzamiento: 5–49 personas.')} />
          <TextField label={t('Administración tributaria')} value={f.taxAdministration} disabled={!can} onChange={(e) => setF({ ...f, taxAdministration: e.target.value })} className="span-2" />
        </div>
      </Card>
      <div className="stack">
        <Card title={t('Revisión del perfil')}>
          {c.profileReviewedAt ? <Callout tone="success">{t('Revisado por {name} el {date}.', { name: c.profileReviewedBy ?? '—', date: formatDate(c.profileReviewedAt) })}</Callout> : <Callout tone="danger">{t('Perfil sin revisar: la emisión permanece bloqueada (PLT-01).')}</Callout>}
          <div style={{ marginTop: 10 }}>
            <KV items={[[t('Domicilio social'), `${c.registeredAddress.street}, ${c.registeredAddress.postalCode} ${c.registeredAddress.city} (${c.registeredAddress.province})`], [t('Centros'), c.worksites.join(' · ')], [t('Zona horaria'), c.timezone]]} />
          </div>
        </Card>
        <Card title={t('Módulos contratados')}>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('Facturas y Gastos')} — <Badge tone="success">{t('activo')}</Badge></li>
            <li>{[t('Jornada y Ausencias'), t('PRL y Documentación'), t('Privacidad'), t('Buzón Oficial')].join(', ')} — <Badge tone="neutral">{t('fuera de esta fase')}</Badge></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function FiscalTab() {
  const ctx = useCtx();
  const fc = ctx.finance;
  const can = ctx.can('settings.company');
  const { runOk, pending } = useAction();
  const [deciding, setDeciding] = useState<null | 'sif' | 'b2b'>(null);
  const [approving, setApproving] = useState(false);
  const upd = (patch: Partial<FinanceConfig>) => runOk(() => updateFinanceConfig(patch), t('Configuración actualizada'));
  const sifRule = deriveSifDeadline(fc, ctx.db.rules, ctx.today);
  const b2bRule = deriveB2bDeadline(fc, ctx.db.rules, ctx.today);
  const decisionLabel: Record<ApplicabilityState, string> = { applicable: t('Aplicable'), not_applicable: t('No aplicable'), pending_review: t('Pendiente de revisión') };
  const Decision = ({ which }: { which: 'sif' | 'b2b' }) => {
    const d = fc[which];
    return (
      <Card title={which === 'sif' ? t('RRSIF / SIF (sistemas de facturación)') : t('Factura electrónica B2B (RD 238/2026)')} actions={can && <Button size="sm" onClick={() => setDeciding(which)}>{t('Registrar decisión')}</Button>}>
        <KV
          items={[
            [t('Decisión'), <Badge tone={d.state === 'applicable' ? 'info' : d.state === 'not_applicable' ? 'neutral' : 'warning'}>{decisionLabel[d.state]}</Badge>],
            [t('Fecha límite'), d.deadline ? <strong>{formatDate(d.deadline)}</strong> : '—'],
            [t('Regla usada'), d.ruleIds.join(', ') || '—'],
            [t('Base de la decisión'), d.basis || '—'],
            [t('Revisor'), d.reviewer ? `${d.reviewer} · ${formatDate(d.reviewedAt)}` : '—'],
            [t('Próxima revisión'), formatDate(d.nextReview)],
            ...(which === 'b2b' ? ([[t('Conector de intercambio'), <Badge tone="danger">{t('No validado — no disponible en el prototipo (FIN-09, condicional)')}</Badge>]] as [string, React.ReactNode][]) : []),
            ...(which === 'sif' ? ([[t('Anuncio pendiente'), <span className="small">{t('Hacienda (05/10/2026) prevé aplazar a octubre de 2028. Sin instrumento en el BOE: no se aplica.')}</span>]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Card>
    );
  };
  return (
    <div className="stack-lg">
      <IssueGatePanel ctx={ctx} showWhenOk />
      <Card title={t('Situación tributaria (determina qué reglas aplican)')} actions={can && <Button size="sm" variant="primary" icon={ShieldCheck} onClick={() => setApproving(true)}>{t('Aprobación del asesor')}</Button>}>
        <div className="form-grid">
          <SelectField label={t('Contribuyente (imposición directa)')} value={fc.taxpayerType} disabled={!can || pending} onChange={(e) => upd({ taxpayerType: e.target.value as FinanceConfig['taxpayerType'] })} hint={t('Plazo SIF derivado: {date}', { date: sifRule.deadline ? formatDate(sifRule.deadline) : '—' })}>
            <option value="IS">{t('Impuesto sobre Sociedades')}</option>
            <option value="IRPF">{t('IRPF (actividad económica)')}</option>
            <option value="IRNR_EP">{t('IRNR con establecimiento permanente')}</option>
            <option value="other">{t('Otro / entidad en atribución de rentas')}</option>
          </SelectField>
          <SelectField label={t('Territorio fiscal (domicilio fiscal)')} value={fc.territory} disabled={!can || pending} onChange={(e) => upd({ territory: e.target.value as FinanceConfig['territory'] })} hint={t('Según la posición fiscal, no solo la dirección postal.')}>
            {Object.entries(TERRITORY_LABEL).map(([k, l]) => <option key={k} value={k}>{SUPPORTED_TERRITORIES.includes(k as FinanceConfig['territory']) ? t(l) : t('{territory} — no soportado', { territory: t(l) })}</option>)}
          </SelectField>
          <SelectField label={t('Régimen de IVA')} value={fc.vatRegime} disabled={!can || pending} onChange={(e) => upd({ vatRegime: e.target.value as FinanceConfig['vatRegime'] })}>
            <option value="general">{t('General')}</option>
            <option value="criterio_caja">{t('Criterio de caja — no soportado')}</option>
            <option value="recargo_equivalencia">{t('Recargo de equivalencia — no soportado')}</option>
            <option value="simplificado">{t('Simplificado — no soportado')}</option>
            <option value="other">{t('Otro — no soportado')}</option>
          </SelectField>
          <SelectField label={t('Volumen de operaciones del año anterior')} value={fc.priorYearTurnoverBand} disabled={!can || pending} onChange={(e) => upd({ priorYearTurnoverBand: e.target.value as FinanceConfig['priorYearTurnoverBand'] })} hint={t('Plazo B2B derivado: {date}', { date: b2bRule.deadline ? formatDate(b2bRule.deadline) : t('desconocido') })}>
            <option value="up_to_8m">{t('Hasta 8 M€')}</option>
            <option value="over_8m">{t('Más de 8 M€')}</option>
            <option value="unknown">{t('Desconocido')}</option>
          </SelectField>
          <SelectField label={t('Modalidad del sistema')} value={fc.sifMode} disabled={!can || pending} onChange={(e) => upd({ sifMode: e.target.value as FinanceConfig['sifMode'] })}>
            <option value="verifactu">{t('VERI*FACTU (vía proveedor)')}</option>
            <option value="no_verifactu">{t('No VERI*FACTU')}</option>
            <option value="undecided">{t('Sin decidir')}</option>
          </SelectField>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <Checkbox label={t('Lleva los libros registro a través del SII')} checked={fc.siiParticipant} disabled={!can || pending} onChange={(v) => upd({ siiParticipant: v })} hint={t('Excluido del RRSIF; flujo no soportado.')} />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          {fc.configApprovedAt ? <Callout tone="success">{t('Configuración aprobada por {by} el {date}. Asesor responsable: {adviser}.', { by: fc.configApprovedBy ?? '—', date: formatDate(fc.configApprovedAt), adviser: fc.responsibleAdviser })}</Callout> : <Callout tone="warning">{t('Configuración sin aprobación del asesor: la emisión está bloqueada. Cambiar un dato de aplicabilidad retira la aprobación anterior.')}</Callout>}
        </div>
      </Card>
      <div className="grid-2">
        <Decision which="sif" />
        <Decision which="b2b" />
      </div>
      <Card title={t('Retención IRPF en facturas emitidas')}>
        <KV items={[[t('Aplica'), fc.irpfWithholding.applies ? t('Sí, {rate} %', { rate: fc.irpfWithholding.ratePct }) : t('No')], [t('Fundamento'), fc.irpfWithholding.basis]]} />
      </Card>
      {deciding && <DecisionDialog which={deciding} onClose={() => setDeciding(null)} />}
      {approving && <ConfirmDialog title={t('Registrar aprobación del asesor')} message={t('Confirma que un profesional cualificado ha revisado regímenes, series y tipos impositivos de esta empresa. No equivale a una certificación de cumplimiento.')} requireReason reasonLabel={t('Nombre del asesor que aprueba')} confirmLabel={t('Registrar aprobación')} onConfirm={(r) => runOk(() => approveFinanceConfig(r), t('Aprobación registrada'))} onClose={() => setApproving(false)} />}
    </div>
  );
}

function DecisionDialog({ which, onClose }: { which: 'sif' | 'b2b'; onClose: () => void }) {
  const ctx = useCtx();
  const d = ctx.finance[which];
  const { runOk, pending } = useAction();
  const [state, setState] = useState<ApplicabilityState>(d.state === 'pending_review' ? 'applicable' : d.state);
  const [reviewer, setReviewer] = useState(d.reviewer ?? '');
  const [basis, setBasis] = useState(d.basis);
  const [next, setNext] = useState(d.nextReview ?? '');
  return (
    <Modal title={t('Decisión de aplicabilidad · {scope}', { scope: which === 'sif' ? 'RRSIF/SIF' : 'B2B' })} description={t('La fecha límite se deriva de la regla vigente en el registro, no se teclea.')} onClose={onClose} footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" loading={pending} onClick={async () => (await runOk(() => recordApplicabilityDecision(which, state, reviewer, basis, next || null), t('Decisión registrada'))) && onClose()}>{t('Registrar')}</Button></>}>
      <SelectField label={t('Decisión')} value={state} onChange={(e) => setState(e.target.value as ApplicabilityState)}>
        <option value="applicable">{t('Aplicable')}</option>
        <option value="not_applicable">{t('No aplicable')}</option>
        <option value="pending_review">{t('Pendiente de revisión')}</option>
      </SelectField>
      <TextField label={t('Profesional que revisa')} required value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
      <TextAreaField label={t('Base de la decisión')} required rows={3} value={basis} onChange={(e) => setBasis(e.target.value)} />
      <TextField label={t('Próxima revisión')} type="date" value={next} onChange={(e) => setNext(e.target.value)} />
    </Modal>
  );
}

function SeriesTab() {
  const ctx = useCtx();
  const series = ctx.db.series.filter((s) => s.companyId === ctx.company.id);
  const [editing, setEditing] = useState<InvoiceSeries | 'new' | null>(null);
  return (
    <Card title={t('Series de facturación')} flush actions={ctx.can('settings.company') && <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>{t('Nueva serie')}</Button>}>
      <table className="table">
        <thead><tr><th>{t('Código')}</th><th>{t('Tipo')}</th><th>{t('Formato')}</th><th className="num">{t('Siguiente número')}</th><th>{t('Facturas')}</th><th>{t('Estado')}</th><th /></tr></thead>
        <tbody>
          {series.map((s) => {
            const used = ctx.db.invoices.filter((i) => i.seriesId === s.id && i.number).length;
            return (
              <tr key={s.id}>
                <td><strong>{s.code}</strong><div className="sub">{s.description}</div></td>
                <td>{s.kind === 'rectifying' ? t('Rectificativas') : t('Ordinaria')}</td>
                <td className="mono">{s.prefix}{'0'.repeat(s.padding - 1)}1</td>
                <td className="num mono">{s.prefix}{String(s.nextNumber).padStart(s.padding, '0')}</td>
                <td>{used}</td>
                <td><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? t('Activa') : t('Cerrada')}</Badge></td>
                <td>{ctx.can('settings.company') && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(s)}>{t('Editar')}</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="card-footer small muted">{t('Numeración correlativa por serie; las rectificativas usan una serie propia (RD 1619/2012, art. 6.1.a). El número se asigna al emitir y el contador nunca retrocede.')}</div>
      {editing && <SeriesDialog series={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function SeriesDialog({ series, onClose }: { series: InvoiceSeries | null; onClose: () => void }) {
  const { runOk, pending } = useAction();
  const [f, setF] = useState({ code: series?.code ?? '', prefix: series?.prefix ?? '', kind: series?.kind ?? 'ordinary', padding: String(series?.padding ?? 4), description: series?.description ?? '', active: series?.active ?? true, nextNumber: String(series?.nextNumber ?? 1) });
  return (
    <Modal title={series ? t('Editar serie {code}', { code: series.code }) : t('Nueva serie')} onClose={onClose} footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" loading={pending} onClick={async () => (await runOk(() => saveSeries(series?.id ?? null, { code: f.code.toUpperCase(), prefix: f.prefix, kind: f.kind as InvoiceSeries['kind'], padding: Number(f.padding), description: f.description, active: f.active, nextNumber: Number(f.nextNumber) }), t('Serie guardada'))) && onClose()}>{t('Guardar')}</Button></>}>
      <div className="form-grid">
        <TextField label={t('Código')} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <TextField label={t('Prefijo')} required value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value })} />
        <SelectField label={t('Tipo')} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as InvoiceSeries['kind'] })}><option value="ordinary">{t('Ordinaria')}</option><option value="rectifying">{t('Rectificativas')}</option></SelectField>
        <TextField label={t('Dígitos')} type="number" min={1} max={8} value={f.padding} onChange={(e) => setF({ ...f, padding: e.target.value })} />
        <TextField label={t('Siguiente número')} type="number" min={1} value={f.nextNumber} onChange={(e) => setF({ ...f, nextNumber: e.target.value })} hint={t('No puede retroceder.')} />
        <TextField label={t('Descripción')} className="span-all" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <Checkbox label={t('Serie activa')} checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
    </Modal>
  );
}

function TaxTab() {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [approving, setApproving] = useState<string | null>(null);
  const supportLabel = { supported: t('Soportado'), requires_review: t('Requiere revisión'), unsupported: t('No soportado') };
  return (
    <Card title={t('Catálogo de tratamientos fiscales')} flush>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('Tratamiento')}</th><th className="num">{t('Tipo impositivo')}</th><th>{t('Calificación')}</th><th>{t('Base legal')}</th><th>{t('Mención obligatoria')}</th><th>{t('Alcance del producto')}</th><th>{t('Aprobado para la empresa')}</th></tr></thead>
          <tbody>
            {ctx.db.taxCodes.map((tc) => {
              const approved = ctx.finance.approvedTaxCodes.includes(tc.code);
              return (
                <tr key={tc.code}>
                  <td><strong>{t(tc.label)}</strong><div className="sub">{t(tc.note)}</div></td>
                  <td className="num">{tc.ratePct} %</td>
                  <td className="mono">{tc.qualification ?? '—'}</td>
                  <td className="small">{tc.legalRef}</td>
                  {/* The mention is printed on the invoice in Spanish; in English the translation is shown underneath as a gloss. */}
                  <td className="small">{tc.mention ? <>{tc.mention}{ctx.lang === 'en' && <div className="sub">{t(tc.mention)}</div>}</> : '—'}</td>
                  <td><Badge tone={tc.supportStatus === 'supported' ? 'success' : tc.supportStatus === 'requires_review' ? 'warning' : 'danger'}>{supportLabel[tc.supportStatus]}</Badge></td>
                  <td>
                    {tc.supportStatus === 'unsupported' ? <span className="muted small">{t('No disponible')}</span> : (
                      <Checkbox label={approved ? t('Sí') : t('No')} checked={approved} disabled={!ctx.can('settings.company')} onChange={(v) => (v && tc.supportStatus === 'requires_review' ? setApproving(tc.code) : runOk(() => setTaxCodeApproval(tc.code, v, ''), v ? t('Tratamiento aprobado') : t('Tratamiento retirado')))} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-footer small muted">{t('Tipos de IVA verificados en la Ley 37/1992 consolidada (09/10/2026): 21 %, 10 % y 4 %; sin tipos temporales vigentes. Solo los tratamientos aprobados pueden usarse en facturas (FIN-02).')}</div>
      {approving && <ConfirmDialog title={t('Aprobar tratamiento que requiere revisión')} message={t('Indique el profesional que ha revisado su aplicación a los servicios de la empresa.')} requireReason reasonLabel={t('Profesional que lo ha revisado')} confirmLabel={t('Aprobar')} onConfirm={(r) => runOk(() => setTaxCodeApproval(approving, true, r), t('Tratamiento aprobado'))} onClose={() => setApproving(null)} />}
    </Card>
  );
}

function PolicyTab() {
  const ctx = useCtx();
  const policy = ctx.db.collectionPolicies.find((p) => p.companyId === ctx.company.id)!;
  const { runOk, pending } = useAction();
  const can = ctx.can('settings.company');
  const [offsets, setOffsets] = useState(policy.reminderOffsetsDays.join(', '));
  const [suppress, setSuppress] = useState(policy.suppressWhenDisputed);
  const [terms, setTerms] = useState(String(ctx.finance.defaultPaymentTermsDays));
  const [sod, setSod] = useState(ctx.finance.requireDifferentApprover);
  return (
    <div className="grid-2">
      <Card title={t('Política de recordatorios')} footer={can && <Button variant="primary" loading={pending} onClick={() => runOk(() => updateCollectionPolicy({ reminderOffsetsDays: offsets.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)), suppressWhenDisputed: suppress }), t('Política guardada'))}>{t('Guardar')}</Button>}>
        <TextField label={t('Días tras el vencimiento')} value={offsets} disabled={!can} onChange={(e) => setOffsets(e.target.value)} hint={t('Separados por comas, p. ej. 3, 15, 30.')} />
        <div style={{ marginTop: 10 }}><Checkbox label={t('Suprimir recordatorios con disputa abierta y retención')} checked={suppress} disabled={!can} onChange={setSuppress} /></div>
        <p className="small muted" style={{ marginTop: 10 }}>{t('Nunca se envían recordatorios de facturas cobradas. Los envíos son simulados.')}</p>
      </Card>
      <Card title={t('Controles internos')} footer={can && <Button variant="primary" loading={pending} onClick={() => runOk(() => updateFinanceConfig({ defaultPaymentTermsDays: Number(terms), requireDifferentApprover: sod }), t('Controles guardados'))}>{t('Guardar')}</Button>}>
        <TextField label={t('Plazo de pago por defecto (días)')} type="number" value={terms} disabled={!can} onChange={(e) => setTerms(e.target.value)} hint={t('Entre empresas: 30 días por defecto y máximo 60 pactados (Ley 3/2004).')} />
        <div style={{ marginTop: 10 }}><Checkbox label={t('La aprobación debe hacerla una persona distinta del autor del borrador')} checked={sod} disabled={!can} onChange={setSod} hint={t('Control interno recomendado (no es una obligación legal).')} /></div>
      </Card>
    </div>
  );
}

function UsersTab() {
  const ctx = useCtx();
  const db = ctx.db;
  const can = ctx.can('settings.users');
  const { runOk } = useAction();
  const members = db.memberships.filter((m) => m.companyId === ctx.company.id);
  const [editing, setEditing] = useState<Membership | 'new' | null>(null);
  const [revoking, setRevoking] = useState<Membership | null>(null);
  const PERMS: [Permission, string][] = [
    ['invoices.edit_draft', t('Preparar borradores')], ['invoices.approve', t('Aprobar facturas')], ['invoices.issue', t('Emitir')], ['invoices.view_drafts', t('Ver borradores')],
    ['payments.record', t('Registrar cobros')], ['payments.reverse', t('Anular cobros')], ['expenses.submit_own', t('Presentar gastos')], ['expenses.review_team', t('Revisar gastos de su equipo')],
    ['expenses.review_all', t('Revisar todos los gastos')], ['fiscal.reconcile', t('Conciliar operaciones')], ['exports.create', t('Exportar')], ['handover.manage', t('Preparar traspasos')],
    ['handover.acknowledge', t('Confirmar traspasos')], ['audit.view', t('Ver auditoría')], ['settings.company', t('Configurar empresa')], ['settings.users', t('Gestionar usuarios')],
  ];
  return (
    <div className="stack-lg">
      <Card title={t('Accesos a la empresa')} flush actions={can && <Button size="sm" icon={UserPlus} onClick={() => setEditing('new')}>{t('Conceder acceso')}</Button>}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Persona')}</th><th>{t('Roles')}</th><th>{t('Límites / mandato')}</th><th>{t('Vigencia')}</th><th>{t('Estado')}</th><th /></tr></thead>
            <tbody>
              {members.map((m) => {
                const u = db.users.find((x) => x.id === m.userId);
                const active = isMembershipActive(m, ctx.today);
                return (
                  <tr key={m.id}>
                    <td><strong>{u?.name}</strong><div className="sub">{u?.email}{u?.organisation ? ` · ${u.organisation}` : ''}</div></td>
                    <td><div className="status-stack">{m.roles.map((r) => <Badge key={r} tone="accent" icon={false}>{t(ROLES[r].label)}</Badge>)}</div></td>
                    <td className="small">
                      {m.approvalLimitCents !== null && <div>{t('Límite: {amount}', { amount: formatEUR(m.approvalLimitCents) })}</div>}
                      {m.teamUserIds.length > 0 && <div>{t('Equipo: {names}', { names: m.teamUserIds.map((id) => userName(db, id)).join(', ') })}</div>}
                      {m.mandateRef && <div>{m.mandateRef}</div>}
                    </td>
                    <td className="small">{t('Desde')} <DateTimeText at={m.grantedAt} />{m.validUntil && <div>{t('Hasta')} <DateText date={m.validUntil} /></div>}</td>
                    <td>{active ? <Badge tone="success">{t('Activo')}</Badge> : <Badge tone="danger">{m.status === 'revoked' ? t('Revocado') : t('Caducado')}</Badge>}{m.revokedAt && <div className="sub"><DateTimeText at={m.revokedAt} /> · {userName(db, m.revokedBy)}</div>}</td>
                    <td>
                      {can && m.status === 'active' && (
                        <div className="row">
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(m)}>{t('Editar')}</Button>
                          {m.userId !== ctx.user.id && <Button size="sm" variant="ghost" icon={UserMinus} onClick={() => setRevoking(m)}>{t('Revocar')}</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-footer small muted">{t('La revocación es inmediata y bloquea lecturas, descargas y acciones posteriores. Prototipo: sin autenticación ni MFA; la autorización real se aplicará en el servidor (PLT-03).')}</div>
      </Card>
      <Card title={t('Matriz de permisos por rol')} flush>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Acción')}</th>{ROLE_ORDER.map((r) => <th key={r} style={{ textAlign: 'center' }}>{t(ROLES[r].label)}</th>)}</tr></thead>
            <tbody>
              {PERMS.map(([p, label]) => (
                <tr key={p}><td>{label} <span className="tiny muted mono">{p}</span></td>{ROLE_ORDER.map((r) => <td key={r} style={{ textAlign: 'center' }}>{ROLES[r].permissions.includes(p) ? <span aria-label={t('Permitido')}>✓</span> : <span className="muted" aria-label={t('No permitido')}>—</span>}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-footer small">{ROLE_ORDER.map((r) => <div key={r}><strong>{t(ROLES[r].label)}:</strong> {t(ROLES[r].description)} <em className="muted">{t(ROLES[r].restriction)}</em></div>)}</div>
      </Card>
      {editing && <MembershipDialog membership={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {revoking && <ConfirmDialog danger title={t('Revocar acceso de {name}', { name: userName(db, revoking.userId) })} message={t('El acceso se bloquea de inmediato. Su identidad se conserva en el historial.')} requireReason confirmLabel={t('Revocar')} onConfirm={(r) => runOk(() => revokeMembership(revoking.id, r), t('Acceso revocado'))} onClose={() => setRevoking(null)} />}
    </div>
  );
}

function MembershipDialog({ membership, onClose }: { membership: Membership | null; onClose: () => void }) {
  const ctx = useCtx();
  const { runOk, pending } = useAction();
  const [roles, setRoles] = useState<RoleId[]>(membership?.roles ?? ['employee']);
  const [validUntil, setValidUntil] = useState(membership?.validUntil ?? '');
  const [limit, setLimit] = useState(membership?.approvalLimitCents !== null && membership?.approvalLimitCents !== undefined ? centsToInput(membership.approvalLimitCents) : '');
  const [team, setTeam] = useState<string[]>(membership?.teamUserIds ?? []);
  const [mandate, setMandate] = useState(membership?.mandateRef ?? '');
  const [user, setUser] = useState({ name: '', email: '', title: '', organisation: '' });
  const employees = ctx.db.memberships.filter((m) => m.companyId === ctx.company.id && m.roles.includes('employee') && m.status === 'active' && m.userId !== membership?.userId);
  const input: MembershipInput = { roles, validUntil: validUntil || null, approvalLimitCents: roles.includes('supervisor') ? parseAmountToCents(limit) : null, teamUserIds: roles.includes('supervisor') ? team : [], mandateRef: mandate || null };
  const toggle = (r: RoleId, v: boolean) => setRoles((rs) => (v ? [...rs, r] : rs.filter((x) => x !== r)));
  return (
    <Modal wide title={membership ? t('Editar acceso · {name}', { name: userName(ctx.db, membership.userId) }) : t('Conceder acceso')} description={t('La invitación es simulada: no se envía ningún correo.')} onClose={onClose} footer={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button variant="primary" loading={pending} onClick={async () => (await runOk(() => (membership ? updateMembership(membership.id, input) : inviteUser({ name: user.name, email: user.email, title: user.title, organisation: user.organisation || null }, input)), t('Acceso guardado'))) && onClose()}>{t('Guardar')}</Button></>}>
      {!membership && (
        <div className="form-grid">
          <TextField label={t('Nombre completo')} required value={user.name} onChange={(e) => setUser({ ...user, name: e.target.value })} />
          <TextField label={t('Correo')} type="email" required value={user.email} onChange={(e) => setUser({ ...user, email: e.target.value })} />
          <TextField label={t('Cargo')} value={user.title} onChange={(e) => setUser({ ...user, title: e.target.value })} />
          <TextField label={t('Organización externa')} value={user.organisation} onChange={(e) => setUser({ ...user, organisation: e.target.value })} hint={t('Solo para asesores externos.')} />
        </div>
      )}
      <fieldset>
        <legend>{t('Roles')}</legend>
        <div className="grid-3">{ROLE_ORDER.map((r) => <Checkbox key={r} label={t(ROLES[r].label)} hint={t(ROLES[r].restriction)} checked={roles.includes(r)} onChange={(v) => toggle(r, v)} />)}</div>
      </fieldset>
      <div className="form-grid">
        <TextField label={t('Válido hasta')} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} hint={t('Obligatorio para asesores externos.')} />
        {roles.includes('gestoria') && <TextField label={t('Referencia del mandato')} required value={mandate} onChange={(e) => setMandate(e.target.value)} className="span-2" />}
        {roles.includes('supervisor') && <TextField label={t('Límite de aprobación (€)')} required inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />}
      </div>
      {roles.includes('supervisor') && (
        <fieldset>
          <legend>{t('Equipo supervisado')}</legend>
          {employees.map((m) => <Checkbox key={m.id} label={userName(ctx.db, m.userId)} checked={team.includes(m.userId)} onChange={(v) => setTeam((ids) => (v ? [...ids, m.userId] : ids.filter((x) => x !== m.userId)))} />)}
        </fieldset>
      )}
    </Modal>
  );
}

/** Rule values are dates, numbers or short reference text ("6 años"); only the text is translated. */
const ruleValue = (v: string) => (isValidISODate(v) ? formatDate(v) : t(v));

function RulesTab() {
  const ctx = useCtx();
  const keys = Array.from(new Set(ctx.db.rules.map((r) => r.key)));
  const statusMeta: Record<RuleVersion['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
    confirmed: { label: t('Confirmada'), tone: 'success' },
    conditional: { label: t('Condicional'), tone: 'info' },
    unresolved: { label: t('Sin resolver'), tone: 'danger' },
    professional_review: { label: t('Revisión profesional'), tone: 'warning' },
    announced: { label: t('Solo anunciada — no se aplica'), tone: 'neutral' },
  };
  return (
    <div className="stack">
      <Callout tone="info" title={t('Registro versionado de reglas (PLT-07)')}>{t('Cada regla guarda jurisdicción, aplicabilidad, publicación, entrada en vigor, fuentes, revisor y próxima revisión. Las versiones anteriores se conservan; ninguna regla se aplica antes de su entrada en vigor y los anuncios sin instrumento publicado nunca se aplican. Investigación de fuentes oficiales: 09/10/2026 (ver docs/01_REGULATORY_RESEARCH.md).')}</Callout>
      {keys.map((k) => {
        const versions = ruleHistory(ctx.db.rules, k);
        const head = versions[versions.length - 1];
        return (
          <Card key={k} title={<div><h2>{t(head.title)}</h2><div className="tiny muted mono">{k}</div></div>} flush>
            <table className="table">
              <thead><tr><th>{t('Versión')}</th><th>{t('Valor')}</th><th>{t('Publicación')}</th><th>{t('Vigor')}</th><th>{t('Estado')}</th><th>{t('Fuentes')}</th><th>{t('Nota')}</th></tr></thead>
              <tbody>
                {versions.map((r) => (
                  <tr key={r.id} style={r.supersededById ? { opacity: 0.7 } : undefined}>
                    <td className="mono small">{r.id}{r.supersededById && <div className="sub">{t('sustituida')}</div>}</td>
                    <td className="strong">{ruleValue(r.value)}</td>
                    <td><DateText date={r.publicationDate} /></td>
                    <td>{r.effectiveDate ? <DateText date={r.effectiveDate} /> : '—'}</td>
                    <td><Badge tone={statusMeta[r.status].tone}>{statusMeta[r.status].label}</Badge></td>
                    <td className="small">{r.sourceIds.join(' · ')}</td>
                    <td className="small">{t(r.note)}{r.nextReview && <div className="sub">{t('Próxima revisión: {date}', { date: formatDate(r.nextReview) })}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}

function DataTab() {
  const ctx = useCtx();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [demoDate, setDemoDate] = useState(ctx.session.demoDate ?? '');
  const size = (readRaw(KEYS.db)?.length ?? 0) / 1024;
  return (
    <div className="grid-2">
      <Card title={t('Almacenamiento local')} actions={<DbIcon size={16} aria-hidden />}>
        <KV
          items={[
            [t('Persistencia'), isPersistent() ? t('localStorage de este navegador') : <Badge tone="warning">{t('Solo en memoria (almacenamiento bloqueado)')}</Badge>],
            [t('Tamaño aproximado'), `${size.toFixed(0)} KB`],
            [t('Datos sembrados'), <DateTimeText at={ctx.db.seededAt} />],
            [t('Registros'), t('{invoices} facturas · {expenses} gastos · {events} eventos de auditoría', { invoices: ctx.db.invoices.length, expenses: ctx.db.expenses.length, events: ctx.db.audit.length })],
          ]}
        />
        <div style={{ marginTop: 12 }}><Callout tone="warning" title={t('Solo para demostración')}>{t('localStorage no es un almacenamiento seguro para datos financieros o personales reales: no está cifrado, es legible por cualquier script del origen y solo existe en este dispositivo.')}</Callout></div>
        <div className="row-wrap" style={{ marginTop: 12 }}>
          <Button icon={Download} onClick={() => { downloadFile(`facturaflow_demo_${realToday()}.json`, JSON.stringify(getDb(), null, 2), 'application/json'); toast.success(t('Copia completa de los datos de demostración descargada')); }}>{t('Descargar todos los datos (JSON)')}</Button>
          <Button variant="danger-outline" icon={RotateCcw} onClick={() => setResetOpen(true)}>{t('Restablecer datos de demostración')}</Button>
        </div>
      </Card>
      <Card title={t('Fecha simulada')} actions={<Clock size={16} aria-hidden />}>
        <p className="small" style={{ marginBottom: 10 }}>{t('Permite probar vencimientos, plazos y la entrada en vigor de reglas (p. ej. fijar 07/10/2027 con volumen > 8 M€ para ver el bloqueo B2B). No cambia la fecha de los registros existentes.')}</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <TextField label={t('Fecha de trabajo')} type="date" value={demoDate} onChange={(e) => setDemoDate(e.target.value)} />
          <Button variant="primary" onClick={() => { setSession({ demoDate: demoDate || null }); toast.info(demoDate ? t('Fecha simulada: {d}', { d: formatDate(demoDate) }) : t('Fecha real restablecida')); }}>{t('Aplicar')}</Button>
          <Button onClick={() => { setDemoDate(''); setSession({ demoDate: null }); }}>{t('Usar fecha real')}</Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <h3>{t('Conservación (referencia)')}</h3>
          <ul className="small" style={{ paddingLeft: 18 }}>
            {ctx.db.rules.filter((r) => r.key === 'retention.financial').map((r) => <li key={r.id}>{t(r.title)}: {ruleValue(r.value)} — {t(r.note)}</li>)}
          </ul>
        </div>
      </Card>
      {resetOpen && (
        <Modal title={t('Restablecer datos de demostración')} onClose={() => setResetOpen(false)} footer={<><Button onClick={() => setResetOpen(false)}>{t('Cancelar')}</Button><Button variant="danger" disabled={confirmText !== 'RESTABLECER'} onClick={() => { resetDemoData(); resetProviderState(); setResetOpen(false); toast.success(t('Datos de demostración restablecidos')); }}>{t('Restablecer')}</Button></>}>
          <Callout tone="danger">{t('Se borrarán todos los cambios realizados en este navegador (facturas, gastos, cobros, auditoría) y se cargarán los datos de ejemplo originales. Esta acción solo existe en el prototipo.')}</Callout>
          <TextField label={t('Escriba "RESTABLECER" para confirmar')} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          <p className="small muted">{t('Sugerencia: descargue antes una copia JSON.')}</p>
        </Modal>
      )}
      <KeyRoundHint />
    </div>
  );
}

function KeyRoundHint() {
  return (
    <Card title={t('Seguridad en producción (pendiente de backend)')} actions={<KeyRound size={16} aria-hidden />}>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t('Autenticación real, MFA para usuarios con privilegios y sesiones seguras (SEC-02).')}</li>
        <li>{t('Autorización y aislamiento entre empresas en cada API, archivo, búsqueda y tarea en segundo plano (SEC-01).')}</li>
        <li>{t('Cifrado en tránsito y en reposo, almacenamiento privado de documentos y descargas temporales (SEC-03).')}</li>
        <li>{t('Auditoría inmutable en servidor con huellas criptográficas (SEC-05). Alojamiento UE/EEE.')}</li>
      </ul>
    </Card>
  );
}
