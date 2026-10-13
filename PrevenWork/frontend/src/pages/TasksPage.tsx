import {
  ListChecks,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import {
  completeTask,
  createPrivacyTask,
  reassignTask,
} from '../services/taskService';
import { TASK_PRIORITY } from '../domain/status';
import { formatDate, today } from '../domain/time';
import type {
  PrivacyTask,
  TaskCategory,
  TaskPriority,
} from '../domain/types';
import { useCtx } from '../store/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  useToast,
} from '../components/ui';
import { t } from '../i18n';

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  rights_request: 'Solicitud de derechos',
  incident_response: 'Respuesta a incidente',
  ropa_review: 'Revisión de tratamiento (RAT)',
  policy_review: 'Revisión de política / DPA',
  supplier_assessment: 'Evaluación de proveedor',
  retention_review: 'Revisión de retención / borrado',
  corrective_action: 'Medida correctora',
  professional_review: 'Dictamen profesional DPO',
};

export function TasksPage() {
  const ctx = useCtx();
  const toast = useToast();
  const now = today();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('open');
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [reassignTaskTarget, setReassignTaskTarget] = useState<PrivacyTask | null>(null);

  const canViewAll = ctx.can('tasks.view_all');
  const allTasks = ctx.db.tasks.filter((t) => t.companyId === ctx.company.id);

  const visibleTasks = canViewAll
    ? allTasks
    : allTasks.filter((t) => t.assignedUserId === ctx.user.id);

  const filtered = visibleTasks.filter((task) => {
    if (filterStatus === 'open' && task.status === 'completed') return false;
    if (filterStatus === 'completed' && task.status !== 'completed') return false;
    if (filterCategory !== 'all' && task.category !== filterCategory) return false;
    if (filterPriority !== 'all' && task.priority !== filterPriority) return false;
    if (filterOverdueOnly && (task.dueDate >= now || task.status === 'completed')) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const match =
        task.title.toLowerCase().includes(q) ||
        task.notes.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('Centro de Tareas y Revisiones de Privacidad')}</h1>
          <p className="page-subtitle">
            {t(
              'Gestión de acciones operativas, revisiones anuales de tratamientos, dictámenes del DPO y plazos de ejecución con avisos de vencimiento.'
            )}
          </p>
        </div>
        <div className="page-actions">
          {ctx.can('tasks.manage') && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setCreateOpen(true)}
            >
              {t('Nueva tarea')}
            </Button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <div className="row wrap gap-3 items-center">
          <div className="grow" style={{ minWidth: 220 }}>
            <Input
              placeholder={t('Buscar por título de tarea o notas…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ width: 170 }}>
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label={t('Estado de tarea')}
            >
              <option value="open">{t('Tareas abiertas')}</option>
              <option value="completed">{t('Tareas completadas')}</option>
              <option value="all">{t('Todas las tareas')}</option>
            </Select>
          </div>

          <div style={{ width: 190 }}>
            <Select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              aria-label={t('Categoría')}
            >
              <option value="all">{t('Todas las categorías')}</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>

          <div style={{ width: 140 }}>
            <Select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              aria-label={t('Prioridad')}
            >
              <option value="all">{t('Prioridad (todas)')}</option>
              {Object.entries(TASK_PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="row gap-2 items-center">
            <Button
              size="sm"
              variant={filterOverdueOnly ? 'danger' : 'ghost'}
              onClick={() => setFilterOverdueOnly((v) => !v)}
            >
              {t('Solo vencidas')}
            </Button>
            {(search || filterCategory !== 'all' || filterPriority !== 'all' || filterStatus !== 'open' || filterOverdueOnly) && (
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setSearch('');
                  setFilterCategory('all');
                  setFilterPriority('all');
                  setFilterStatus('open');
                  setFilterOverdueOnly(false);
                }}
              >
                {t('Limpiar')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Tasks Table */}
      <Card>
        <Table>
          <thead>
            <tr>
              <th>{t('Tarea')}</th>
              <th>{t('Categoría')}</th>
              <th>{t('Asignado a')}</th>
              <th>{t('Fecha límite')}</th>
              <th>{t('Prioridad')}</th>
              <th>{t('Estado')}</th>
              <th>{t('Acciones')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted">
                  <EmptyState icon={ListChecks} title="Sin tareas pendientes">
                    {t('No constan tareas que coincidan con los filtros seleccionados.')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              filtered.map((task) => {
                const isOverdue = task.status !== 'completed' && task.dueDate < now;
                const priorityMeta = TASK_PRIORITY[task.priority];
                const assignee = ctx.db.users.find((u) => u.id === task.assignedUserId);

                return (
                  <tr key={task.id} className="hover-surface">
                    <td>
                      <div className="strong">{task.title}</div>
                      {task.notes && (
                        <div className="tiny muted text-truncate" style={{ maxWidth: 280 }}>
                          {task.notes}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="tiny font-semibold">{CATEGORY_LABELS[task.category]}</span>
                    </td>
                    <td>
                      <span className="tiny">{assignee?.name ?? task.assignedUserId}</span>
                    </td>
                    <td>
                      <span
                        className={`tiny font-mono ${
                          isOverdue ? 'text-danger font-semibold' : ''
                        }`}
                      >
                        {formatDate(task.dueDate)}
                        {isOverdue && <span className="ml-1">⚠️ Vencida</span>}
                      </span>
                    </td>
                    <td>
                      <Badge tone={priorityMeta.tone}>{priorityMeta.label}</Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          task.status === 'completed'
                            ? 'success'
                            : task.status === 'in_progress'
                            ? 'info'
                            : isOverdue
                            ? 'danger'
                            : 'neutral'
                        }
                      >
                        {task.status === 'completed'
                          ? t('Completada')
                          : isOverdue
                          ? t('Vencida')
                          : t('Pendiente')}
                      </Badge>
                    </td>
                    <td>
                      <div className="row gap-1">
                        {task.status !== 'completed' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              try {
                                completeTask(task.id);
                                toast.success(t('Tarea marcada como completada.'));
                              } catch (e) {
                                toast.error(e);
                              }
                            }}
                          >
                            ✓ {t('Completar')}
                          </Button>
                        )}

                        {ctx.can('tasks.manage') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setReassignTaskTarget(task)}
                          >
                            {t('Reasignar')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* Modal: Create Task */}
      {createOpen && (
        <CreateTaskModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            toast.success(t('Tarea creada y asignada en el calendario.'));
          }}
        />
      )}

      {/* Modal: Reassign Task */}
      {reassignTaskTarget && (
        <ReassignTaskModal
          task={reassignTaskTarget}
          onClose={() => setReassignTaskTarget(null)}
          onSuccess={() => {
            setReassignTaskTarget(null);
            toast.success(t('Tarea reasignada correctamente.'));
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Modals ───────────────────────────────

function CreateTaskModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskCategory>('ropa_review');
  const [assignedUserId, setAssignedUserId] = useState(ctx.user.id);
  const [dueDate, setDueDate] = useState('2026-11-30');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      createPrivacyTask(
        title,
        category,
        assignedUserId,
        dueDate,
        priority,
        notes
      );
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Nueva Tarea de Privacidad')}
      onClose={onClose}
      maxWidth={520}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Título de la tarea" required>
          <Input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Revisión anual RAT-003 Recursos Humanos"
          />
        </FormField>

        <div className="grid-2 gap-4">
          <FormField label="Categoría" required>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as TaskCategory)}
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Prioridad" required>
            <Select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {Object.entries(TASK_PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="grid-2 gap-4">
          <FormField label="Asignado a" required>
            <Select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
            >
              {ctx.db.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.organisation})
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Fecha límite de vencimiento" required>
            <Input
              required
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Notas o instrucciones para el ejecutor">
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Detalles de la comprobación a realizar..."
          />
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Crear tarea')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReassignTaskModal({
  task,
  onClose,
  onSuccess,
}: {
  task: PrivacyTask;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const ctx = useCtx();
  const toast = useToast();
  const [newOwnerId, setNewOwnerId] = useState(task.assignedUserId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      reassignTask(task.id, newOwnerId);
      onSuccess();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      title={t('Reasignar Tarea: {title}', { title: task.title })}
      onClose={onClose}
      maxWidth={440}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Nuevo usuario responsable" required>
          <Select
            value={newOwnerId}
            onChange={(e) => setNewOwnerId(e.target.value)}
          >
            {ctx.db.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.organisation})
              </option>
            ))}
          </Select>
        </FormField>

        <div className="modal-footer row end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit">
            {t('Confirmar')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
