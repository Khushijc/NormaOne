import { CheckCheck, ListChecks, Mail, MailOpen, Scale, Target } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, DateText, DateTimeText, EmptyState, PageHeader, Tabs } from '../components/ui';
import { diffDays } from '../domain/dates';
import { t, tKey } from '../i18n';
import { markAllRead, markRead, myTasks, ROLE_SHORT, visibleNotifications } from '../services/notificationService';
import { useCtx } from '../store/hooks';

const CATEGORY_LABEL = {
  fiscal: tKey('Fiscal'),
  aprobacion: tKey('Aprobación / emisión'),
  gastos: tKey('Gastos'),
  cobros: tKey('Cobros'),
  traspaso: tKey('Traspaso'),
  normativo: tKey('Normativo'),
  integracion: tKey('Integración'),
} as const;

export function TasksPage() {
  const ctx = useCtx();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'avisos' ? 'avisos' : 'tareas';
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [cat, setCat] = useState('');
  const tasks = myTasks(ctx).filter((task) => !cat || task.category === cat);
  const notes = visibleNotifications(ctx).filter((n) => !unreadOnly || !n.readBy[ctx.user.id]);
  const unread = visibleNotifications(ctx).filter((n) => !n.readBy[ctx.user.id]).length;
  const SEVERITY = { high: t('Alta'), medium: t('Media'), low: t('Baja') };

  return (
    <>
      <PageHeader title={t('Tareas y avisos')} subtitle={t('Cada tarea crítica tiene responsable, suplente, origen, fecha y regla de evidencia. Se distinguen los plazos legales de los objetivos internos.')} />
      <Tabs label={t('Tareas y avisos')} value={tab} onChange={(v) => setParams(v === 'tareas' ? {} : { tab: v }, { replace: true })} tabs={[{ id: 'tareas', label: t('Tareas'), count: myTasks(ctx).length }, { id: 'avisos', label: t('Avisos'), count: unread }]} />
      {tab === 'tareas' && (
        <Card flush actions={undefined}>
          <div className="toolbar">
            <div className="field">
              <label htmlFor="t-cat">{t('Categoría')}</label>
              <select id="t-cat" className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">{t('Todas')}</option>
                {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
              </select>
            </div>
            <p className="small muted" style={{ alignSelf: 'center' }}>{t('Tareas derivadas de los registros: desaparecen cuando se aporta la evidencia requerida, no al marcarlas.')}</p>
          </div>
          {tasks.length === 0 ? <EmptyState icon={ListChecks} title={t('No tiene tareas pendientes')} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('Prioridad')}</th><th>{t('Tarea')}</th><th>{t('Responsable / suplente')}</th><th>{t('Origen')}</th><th>{t('Fecha')}</th><th>{t('Evidencia para cerrar')}</th></tr></thead>
                <tbody>
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <td><Badge tone={task.severity === 'high' ? 'danger' : task.severity === 'medium' ? 'warning' : 'neutral'}>{SEVERITY[task.severity]}</Badge></td>
                      <td><Link to={task.link} className="strong">{t(task.title)}</Link><div className="sub">{t(CATEGORY_LABEL[task.category])} · {t(task.detail)}</div></td>
                      <td className="small">{t(ROLE_SHORT[task.ownerRole])}<div className="sub">{t('Suplente: {role}', { role: t(ROLE_SHORT[task.backupRole]) })}</div></td>
                      <td className="small">{t(task.trigger)}</td>
                      <td className="small nowrap">
                        {task.dueDate ? <DateText date={task.dueDate} /> : '—'}
                        <div>
                          {task.deadlineKind === 'legal' ? <Badge tone="danger" icon={Scale}>{t('Plazo legal')}</Badge> : task.deadlineKind === 'internal' ? <Badge tone="neutral" icon={Target}>{t('Objetivo interno')}</Badge> : null}
                        </div>
                        {task.dueDate && <div className="sub">{diffDays(ctx.today, task.dueDate) < 0 ? t('Vencida hace {n} d', { n: -diffDays(ctx.today, task.dueDate) }) : t('En {n} d', { n: diffDays(ctx.today, task.dueDate) })}</div>}
                      </td>
                      <td className="small">{t(task.evidenceRule)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === 'avisos' && (
        <Card
          flush
          title={t('Avisos')}
          actions={
            <>
              <label className="checkbox small"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> {t('Solo sin leer')}</label>
              <Button size="sm" icon={CheckCheck} onClick={() => markAllRead()} disabled={unread === 0}>{t('Marcar todo leído')}</Button>
            </>
          }
        >
          {notes.length === 0 ? <EmptyState title={t('No hay avisos')} /> : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {notes.map((n) => {
                const read = !!n.readBy[ctx.user.id];
                return (
                  <li key={n.id} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                    {!read ? <span className="unread-dot" aria-label={t('Sin leer')} /> : <span style={{ width: 8 }} />}
                    <div className="grow">
                      <Link to={n.link} onClick={() => markRead(n.id)} className={read ? '' : 'strong'}>{t(n.title)}</Link>
                      <div className="small muted">{t(n.body)} · <DateTimeText at={n.createdAt} /></div>
                    </div>
                    <Button size="sm" variant="ghost" icon={read ? Mail : MailOpen} onClick={() => markRead(n.id, !read)}>{read ? t('Marcar no leído') : t('Marcar leído')}</Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="card-footer tiny muted">{t('Los avisos no incluyen importes ni datos personales. El aviso por correo es una futura integración: una entrega correcta de correo no prueba que la acción se haya realizado.')}</div>
        </Card>
      )}
    </>
  );
}
