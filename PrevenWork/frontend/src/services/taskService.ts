/**
 * Privacy Task Centre Service.
 */
import { NotFoundError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { PrivacyTask, TaskCategory, TaskPriority } from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export function createPrivacyTask(
  title: string,
  category: TaskCategory,
  assignedUserId: string,
  dueDate: string,
  priority: TaskPriority,
  notes: string = '',
  linkedEntityId?: string,
  linkedEntityType?: string
): PrivacyTask {
  const ctx = getServiceCtx();
  ctx.assert('tasks.manage', 'No tiene permisos para crear tareas.');

  const task: PrivacyTask = {
    id: newId('tsk'),
    companyId: ctx.company.id,
    title,
    category,
    linkedEntityId,
    linkedEntityType,
    assignedUserId,
    dueDate,
    priority,
    status: 'open',
    notes,
    createdAt: nowInstant(),
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('tasks', task);
      tx.audit({
        action: 'task.created',
        entityType: 'PrivacyTask',
        entityId: task.id,
        entityLabel: task.title,
        summary: `Creada tarea: ${task.title} (asignada a ${assignedUserId}, vence ${dueDate}).`,
      });
      return task;
    }
  );
}

export function completeTask(id: string): PrivacyTask {
  const ctx = getServiceCtx();
  const task = ctx.db.tasks.find((t) => t.id === id && t.companyId === ctx.company.id);
  if (!task) throw new NotFoundError('Tarea no encontrada.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('tasks', id, {
        status: 'completed',
        completedAt: nowInstant(),
      });
      tx.audit({
        action: 'task.completed',
        entityType: 'PrivacyTask',
        entityId: id,
        entityLabel: task.title,
        summary: `Tarea completada: ${task.title}.`,
      });
      return updated;
    }
  );
}

export function reassignTask(id: string, newUserId: string): PrivacyTask {
  const ctx = getServiceCtx();
  ctx.assert('tasks.manage', 'No tiene permisos para reasignar tareas.');

  const task = ctx.db.tasks.find((t) => t.id === id && t.companyId === ctx.company.id);
  if (!task) throw new NotFoundError('Tarea no encontrada.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      const updated = tx.update('tasks', id, {
        assignedUserId: newUserId,
      });
      tx.audit({
        action: 'task.reassigned',
        entityType: 'PrivacyTask',
        entityId: id,
        entityLabel: task.title,
        summary: `Tarea ${task.title} reasignada al usuario ${newUserId}.`,
      });
      return updated;
    }
  );
}

