/**
 * SIMULATED share links of a CAE case: scoped to the case, one recipient participant, a set of
 * shareable versions (accepted, ordinary, worksite-relevant) and an expiry within the company
 * maximum. Nothing leaves the prototype; every simulated access is recorded.
 */
import { Ban, Eye, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Callout, Card, Checkbox, ConfirmDialog, DateText, DateTimeText, EmptyState, Modal, SelectField, SimulatedTag, TextField, describeError, useAction } from '../../components/ui';
import { addDays } from '../../domain/time';
import type { CaeCase, DocumentVersion, EvidenceDocument, ID, ShareLink } from '../../domain/types';
import { t } from '../../i18n';
import { createShareLink, revokeShareLink, shareableVersions, simulateLinkAccess } from '../../services/caeService';
import { useCtx, type UiCtx } from '../../store/hooks';
import { participantName } from './worksiteShared';

type Access = { link: ShareLink; docs: { doc: EvidenceDocument; version: DocumentVersion }[] } | { link: ShareLink; denied: { title: string; details: string[] } };

function linkState(ctx: UiCtx, l: ShareLink): { label: string; tone: 'success' | 'neutral' | 'danger' } {
  if (l.revokedAt) return { label: t('Revocado'), tone: 'neutral' };
  if (l.expiresOn < ctx.today) return { label: t('Caducado'), tone: 'danger' };
  return { label: t('Activo'), tone: 'success' };
}

export function ShareLinksPanel({ kase, canManage }: { kase: CaeCase; canManage: boolean }) {
  const ctx = useCtx();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ShareLink | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [busyId, setBusyId] = useState<ID | null>(null);
  const { runOk } = useAction();
  const links = ctx.db.shareLinks.filter((l) => l.caseId === kase.id && l.companyId === ctx.company.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const shareable = shareableVersions(ctx, kase);
  const closed = kase.status === 'closed';
  const versionLabel = (vid: ID) => {
    const v = ctx.db.docVersions.find((x) => x.id === vid);
    const d = v ? ctx.db.documents.find((x) => x.id === v.documentId) : undefined;
    return d && v ? `${d.code} · ${d.title} · v${v.version}` : vid;
  };

  // The service records the attempt (allowed or refused); the result is shown either way.
  const simulate = async (l: ShareLink) => {
    setBusyId(l.id);
    try {
      const r = await simulateLinkAccess(l.id);
      setAccess({ link: l, docs: r.docs });
    } catch (e) {
      setAccess({ link: l, denied: describeError(e) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      <Callout tone="warning" title={<span className="row-wrap" style={{ gap: 6 }}>{t('Enlaces de consulta simulados')} <SimulatedTag /></span>}>
        {t('En este prototipo no se comparte nada fuera de la aplicación. Cada enlace se limita a este caso, a un destinatario participante y a una caducidad de como máximo {n} días; cada acceso queda registrado y el enlace puede revocarse.', { n: ctx.settings.shareLinkMaxDays })}
      </Callout>

      <Card
        title={t('Enlaces del caso')}
        actions={
          canManage && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)} disabled={closed || shareable.length === 0}>
              {t('Crear enlace simulado')}
            </Button>
          )
        }
        flush
      >
        {links.length === 0 ? (
          <EmptyState icon={Link2} title={t('Sin enlaces creados')}>
            {shareable.length === 0 ? t('No hay evidencia aceptada y relevante para este centro que se pueda compartir.') : t('Cree un enlace simulado para que un participante consulte la evidencia aceptada del centro.')}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Enlaces del caso')}</caption>
              <thead>
                <tr>
                  <th>{t('Token')}</th>
                  <th>{t('Destinatario')}</th>
                  <th>{t('Documentos')}</th>
                  <th>{t('Creado')}</th>
                  <th>{t('Caduca')}</th>
                  <th>{t('Estado')}</th>
                  <th>{t('Registro de accesos')}</th>
                  {canManage && <th>{t('Acciones')}</th>}
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const st = linkState(ctx, l);
                  return (
                    <tr key={l.id}>
                      <td className="nowrap">
                        <code className="cae-token">{l.token}</code>
                        <div>
                          <SimulatedTag />
                        </div>
                      </td>
                      <td className="small">{participantName(kase, l.recipientParticipantId)}</td>
                      <td className="small">
                        <ul className="cae-plain-list">
                          {l.documentVersionIds.map((vid) => (
                            <li key={vid}>{versionLabel(vid)}</li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <DateTimeText at={l.createdAt} />
                      </td>
                      <td>
                        <DateText date={l.expiresOn} />
                      </td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {l.revokedAt && (
                          <div className="tiny muted">
                            <DateTimeText at={l.revokedAt} />
                          </div>
                        )}
                      </td>
                      <td className="small">
                        {l.accessLog.length === 0 ? (
                          <span className="muted">{t('Sin accesos')}</span>
                        ) : (
                          <>
                            <div>{t('{n} accesos', { n: l.accessLog.length })}</div>
                            <ul className="cae-plain-list tiny muted">
                              {[...l.accessLog].reverse().slice(0, 3).map((a, i) => (
                                <li key={i}>
                                  <DateTimeText at={a} />
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </td>
                      {canManage && (
                        <td>
                          <div className="cae-row-actions">
                            <Button size="sm" icon={Eye} loading={busyId === l.id} onClick={() => simulate(l)}>
                              {t('Simular acceso del destinatario')}
                            </Button>
                            {!l.revokedAt && (
                              <Button size="sm" variant="danger-outline" icon={Ban} onClick={() => setRevoking(l)}>
                                {t('Revocar')}
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('Evidencia que se puede enviar o compartir')} flush>
        {shareable.length === 0 ? (
          <EmptyState icon={Link2} title={t('Sin evidencia compartible')}>
            {t('Solo se comparte evidencia aceptada, no restringida y relevante para este centro.')}
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">{t('Evidencia que se puede enviar o compartir')}</caption>
                <thead>
                  <tr>
                    <th>{t('Documento')}</th>
                    <th>{t('Versión aceptada')}</th>
                    <th>{t('Emisor')}</th>
                    <th>{t('Caducidad legal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shareable.map(({ doc, version }) => (
                    <tr key={version.id}>
                      <td>
                        <Link to={`/documentacion/${doc.id}`}>{doc.title}</Link>
                        <div className="tiny muted">{doc.code}</div>
                      </td>
                      <td className="nowrap">v{version.version}</td>
                      <td className="small">{version.issuer}</td>
                      <td className="small">{version.legalExpiryDate ? <DateText date={version.legalExpiryDate} /> : version.expiryMode === 'none' ? t('Sin caducidad') : t('Revisión necesaria')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-body">
              <p className="tiny muted">{t('Solo evidencia aceptada, ordinaria (sin datos de salud ni documentos restringidos o individuales) y relevante para este centro.')}</p>
            </div>
          </>
        )}
      </Card>

      {creating && <CreateLinkModal kase={kase} onClose={() => setCreating(false)} />}
      {revoking && (
        <ConfirmDialog
          title={t('Revocar el enlace {token}', { token: revoking.token })}
          danger
          confirmLabel={t('Revocar enlace')}
          requireReason
          message={<p className="small">{t('Los accesos posteriores se rechazarán y quedarán registrados. El enlace y su registro de accesos se conservan.')}</p>}
          onConfirm={(reason) => runOk(() => revokeShareLink(revoking.id, reason), t('Enlace revocado'))}
          onClose={() => setRevoking(null)}
        />
      )}
      {access && (
        <Modal
          title={<span className="row-wrap" style={{ gap: 6 }}>{t('Vista del destinatario')} <SimulatedTag /></span>}
          description={t('{org} · enlace {token}', { org: participantName(kase, access.link.recipientParticipantId), token: access.link.token })}
          onClose={() => setAccess(null)}
          footer={<Button onClick={() => setAccess(null)}>{t('Cerrar')}</Button>}
        >
          {'denied' in access ? (
            <div className="stack">
              <Callout tone="danger" title={t('Acceso rechazado')}>
                {access.denied.title}
                {access.denied.details.length > 0 && (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {access.denied.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </Callout>
              <p className="small muted">{t('El intento de acceso queda registrado en el historial del caso.')}</p>
            </div>
          ) : (
            <div className="stack">
              <p className="small">{t('Esto es lo que vería el destinatario al abrir el enlace. El acceso queda registrado.')}</p>
              {access.docs.length === 0 ? (
                <EmptyState icon={Link2} title={t('El enlace no contiene documentos disponibles')} />
              ) : (
                <ul className="cae-recipient-docs">
                  {access.docs.map(({ doc, version }) => (
                    <li key={version.id}>
                      <div className="strong">{doc.title}</div>
                      <div className="tiny muted">
                        {doc.code} · v{version.version} · {version.issuer}
                        {version.issueDate ? ' · ' : ''}
                        {version.issueDate && <DateText date={version.issueDate} />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="tiny muted">{t('Que el destinatario consulte un documento no implica que lo haya entendido ni aceptado.')}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function CreateLinkModal({ kase, onClose }: { kase: CaeCase; onClose: () => void }) {
  const ctx = useCtx();
  const { run, pending } = useAction();
  const recipients = kase.participants.filter((p) => !p.isOwnCompany);
  const shareable = shareableVersions(ctx, kase);
  const max = addDays(ctx.today, ctx.settings.shareLinkMaxDays);
  const min = addDays(ctx.today, 1);
  const [recipient, setRecipient] = useState<ID>(recipients[0]?.id ?? '');
  const [selected, setSelected] = useState<ID[]>([]);
  const [expires, setExpires] = useState(addDays(ctx.today, Math.min(14, ctx.settings.shareLinkMaxDays)));
  const [touched, setTouched] = useState(false);
  const errors: Record<string, string> = {};
  if (!recipient) errors.recipient = t('Obligatorio.');
  if (!selected.length) errors.docs = t('Seleccione al menos un documento.');
  if (!expires) errors.expires = t('Obligatorio.');
  else if (expires < min || expires > max) errors.expires = t('Entre mañana y {n} días.', { n: ctx.settings.shareLinkMaxDays });
  const submit = async () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    const r = await run(() => createShareLink(kase.id, recipient, selected, expires), (l) => t('Enlace simulado {token} creado', { token: l.token }));
    if (r) onClose();
  };
  return (
    <Modal
      wide
      title={<span className="row-wrap" style={{ gap: 6 }}>{t('Crear enlace simulado')} <SimulatedTag /></span>}
      description={t('No se envía nada fuera del prototipo: el enlace solo permite simular la consulta del destinatario.')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {t('Crear enlace simulado')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <SelectField label={t('Destinatario')} required value={recipient} onChange={(e) => setRecipient(e.target.value)} error={touched ? errors.recipient : undefined} hint={t('Otra empresa participante del caso.')}>
            {recipients.length === 0 && <option value="">{t('Añada antes otra empresa participante')}</option>}
            {recipients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.organisation} · {p.contactName}
              </option>
            ))}
          </SelectField>
          <TextField label={t('Caducidad del enlace')} type="date" required min={min} max={max} value={expires} onChange={(e) => setExpires(e.target.value)} error={touched ? errors.expires : undefined} hint={t('Máximo {n} días.', { n: ctx.settings.shareLinkMaxDays })} />
        </div>
        <fieldset>
          <legend className="small strong">{t('Documentos que verá el destinatario')}</legend>
          <div className="stack-sm">
            {shareable.map(({ doc, version }) => (
              <Checkbox
                key={version.id}
                checked={selected.includes(version.id)}
                onChange={(on) => setSelected((s) => (on ? [...s, version.id] : s.filter((x) => x !== version.id)))}
                label={`${doc.code} · ${doc.title} · v${version.version}`}
                hint={version.issuer}
              />
            ))}
          </div>
          {touched && errors.docs && (
            <p className="small" role="alert" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>
              {errors.docs}
            </p>
          )}
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            {t('Solo evidencia aceptada, ordinaria y relevante para este centro.')}
          </p>
        </fieldset>
      </div>
    </Modal>
  );
}
