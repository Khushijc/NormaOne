/**
 * Mis tareas: the caller's unified inbox from `myTasks(ctx)` — their own pending items
 * (acknowledgements, evidence, PPE receipt, training, assigned actions) and the reviews assigned
 * to them. Employees can confirm receipt of information and of equipment directly here; a
 * confirmation proves receipt only and never replaces training.
 */
import { CheckCheck, ChevronDown, ChevronUp, ExternalLink, Inbox, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, Card, ConfirmDialog, EmptyState, PageHeader, Tabs, useAction } from '../components/ui';
import { t } from '../i18n';
import { itemsFor } from '../services/context';
import { acknowledgeDocument, acknowledgeIssue, documentState } from '../services/evidenceService';
import { myTasks, type Task } from '../services/opsService';
import { useCtx, type UiCtx } from '../store/hooks';
import { DUE_LABEL, TASK_KIND, TASK_ORDER, TaskDue, type TaskKind } from './home/parts';

type Tab = 'all' | 'own' | 'review';

/** What can be confirmed directly from the inbox. */
type Confirmable = { kind: 'document'; id: string; title: string; version: number | null } | { kind: 'issue'; id: string; title: string };

function confirmableOf(ctx: UiCtx, task: Task): Confirmable | null {
  if (!ctx.employee || !ctx.can('own.acknowledge')) return null;
  if (task.kind === 'acknowledge') {
    const item = itemsFor(ctx, ctx.employee.id).find((it) => `ack:${it.key}` === task.id);
    const docId = item?.evidence.documentId ?? null;
    if (!docId) return null;
    const doc = ctx.db.documents.find((d) => d.id === docId);
    const accepted = documentState(ctx, docId).accepted;
    if (!doc || !accepted) return null;
    return { kind: 'document', id: docId, title: doc.title, version: accepted.version };
  }
  if (task.kind === 'ppe_ack') {
    const issueId = task.id.slice('ppe:'.length);
    return ctx.db.issues.some((i) => i.id === issueId) ? { kind: 'issue', id: issueId, title: task.detail } : null;
  }
  return null;
}

const byOrder = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title, 'es');

export function TasksPage() {
  const ctx = useCtx();
  const { runOk } = useAction();
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<TaskKind>>(new Set());
  const [confirming, setConfirming] = useState<Confirmable | null>(null);
  const tasks = useMemo(() => myTasks(ctx), [ctx]);
  const own = tasks.filter((x) => TASK_KIND[x.kind].group === 'own');
  const reviews = tasks.filter((x) => TASK_KIND[x.kind].group === 'review');
  const needle = q.trim().toLowerCase();
  const shown = (tab === 'own' ? own : tab === 'review' ? reviews : tasks).filter((x) => !needle || `${t(x.title)} ${x.detail}`.toLowerCase().includes(needle));
  const groups = TASK_ORDER.map((k) => ({ kind: k, rows: shown.filter((x) => x.kind === k).sort(byOrder) })).filter((g) => g.rows.length > 0);
  const overdue = tasks.filter((x) => x.due && x.due < ctx.today).length;

  const toggle = (k: TaskKind) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const confirm = async () => {
    if (!confirming) return false;
    const c = confirming;
    return runOk(() => (c.kind === 'document' ? acknowledgeDocument(c.id) : acknowledgeIssue(c.id)), c.kind === 'document' ? t('Recepción de la información confirmada') : t('Recepción del equipo confirmada'));
  };

  return (
    <>
      <PageHeader title={t('Mis tareas')} subtitle={t('Lo que le corresponde hacer a continuación: sus pendientes y las revisiones que tiene asignadas.')} />
      <div className="stack-lg">
        {tasks.length > 0 && (
          <div className="row-wrap small">
            <span><strong className="num">{tasks.length}</strong> {t('tareas en total')}</span>
            <span className="muted">·</span>
            <span><strong className="num">{own.length}</strong> {t('propias')}</span>
            <span className="muted">·</span>
            <span><strong className="num">{reviews.length}</strong> {t('revisiones')}</span>
            {overdue > 0 && (
              <>
                <span className="muted">·</span>
                <span className="home-danger strong">{t('{n} con la fecha superada', { n: overdue })}</span>
              </>
            )}
          </div>
        )}
        <Card flush>
          <Tabs<Tab>
            label={t('Tipo de tarea')}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: t('Todas'), count: tasks.length },
              { id: 'own', label: t('Mis pendientes'), count: own.length },
              { id: 'review', label: t('Revisiones asignadas'), count: reviews.length },
            ]}
          />
          <div className="toolbar" role="search" aria-label={t('Filtros')}>
            <div className="field search">
              <label htmlFor="tasks-q">{t('Buscar')}</label>
              <input id="tasks-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Título, código o persona')} />
            </div>
          </div>
          {groups.length === 0 ? (
            tasks.length === 0 ? (
              <EmptyState icon={Inbox} title={t('No tiene tareas pendientes')}>
                {t('Cuando le pidan una evidencia, una confirmación o una revisión, aparecerá aquí.')}
              </EmptyState>
            ) : (
              <EmptyState icon={Search} title={t('Ninguna tarea coincide con la búsqueda')} action={<Button size="sm" onClick={() => { setQ(''); setTab('all'); }}>{t('Limpiar filtros')}</Button>} />
            )
          ) : (
            <div className="tasks-groups">
              {groups.map((g) => {
                const meta = TASK_KIND[g.kind];
                const Icon = meta.icon;
                const open = expanded.has(g.kind);
                const rows = open ? g.rows : g.rows.slice(0, 8);
                return (
                  <section key={g.kind} className="tasks-group" aria-labelledby={`tg-${g.kind}`}>
                    <h2 id={`tg-${g.kind}`} className="tasks-group-title">
                      <Icon size={16} aria-hidden />
                      {t(meta.label)}
                      <span className="tag">{g.rows.length}</span>
                    </h2>
                    <ul className="tasks-list">
                      {rows.map((task) => {
                        const c = confirmableOf(ctx, task);
                        return (
                          <li key={task.id} className="tasks-row">
                            <div className="grow home-min0">
                              <div className="strong">{t(task.title)}</div>
                              <div className="small muted tasks-detail">{t(task.detail)}</div>
                            </div>
                            <div className="tasks-due">
                              {task.due && DUE_LABEL[task.kind] && <span className="tiny muted home-block">{t(DUE_LABEL[task.kind]!)}</span>}
                              {task.due ? <TaskDue task={task} today={ctx.today} /> : null}
                            </div>
                            <div className="row-wrap tasks-actions">
                              {c && (
                                <Button size="sm" variant="primary" icon={CheckCheck} onClick={() => setConfirming(c)}>
                                  {t('Confirmar recepción')}
                                </Button>
                              )}
                              <Link to={task.link} className="btn sm" aria-label={t('Abrir: {title}', { title: `${t(task.title)} · ${task.detail}` })}>
                                <ExternalLink size={14} aria-hidden /> {t('Abrir')}
                              </Link>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {g.rows.length > 8 && (
                      <div className="tasks-more">
                        <Button size="sm" variant="ghost" icon={open ? ChevronUp : ChevronDown} onClick={() => toggle(g.kind)} aria-expanded={open}>
                          {open ? t('Mostrar menos') : t('Mostrar las {n} restantes', { n: g.rows.length - 8 })}
                        </Button>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </Card>
        <Callout tone="neutral">
          {t('Confirmar la recepción de información o de un equipo no acredita la formación. Subir un documento no es su aprobación: lo decide la autoridad de revisión configurada.')}
        </Callout>
      </div>
      {confirming && (
        <ConfirmDialog
          title={confirming.kind === 'document' ? t('Confirmar la recepción de la información') : t('Confirmar la recepción del equipo')}
          confirmLabel={t('Confirmar recepción')}
          onClose={() => setConfirming(null)}
          onConfirm={confirm}
          message={
            <div className="stack-sm">
              <div>
                <span className="strong">{confirming.title}</span>
                {confirming.kind === 'document' && confirming.version !== null && <span className="muted small"> · {t('versión vigente {n}', { n: confirming.version })}</span>}
              </div>
              <p className="small" style={{ margin: 0 }}>
                {confirming.kind === 'document'
                  ? t('Declara que ha recibido y leído la versión vigente de esta información.')
                  : t('Declara que ha recibido el equipo y las instrucciones de uso y mantenimiento del fabricante.')}
              </p>
              <Callout tone="info">{t('La confirmación acredita la recepción; no sustituye a la formación.')}</Callout>
            </div>
          }
        />
      )}
    </>
  );
}
