/**
 * Privacy Documents and Policies Service.
 */
import { NotFoundError } from '../domain/permissions';
import { newId } from '../domain/ids';
import { nowInstant } from '../domain/time';
import type { DocumentType, DocumentVersion, PrivacyDocument } from '../domain/types';
import { transact } from '../store/db';
import { getServiceCtx } from './context';

export function createDocument(
  title: string,
  type: DocumentType,
  ownerId: string,
  reviewerId: string,
  nextReviewDate: string,
  linkedRopaIds: string[] = []
): { document: PrivacyDocument; version: DocumentVersion } {
  const ctx = getServiceCtx();
  ctx.assert('documents.manage', 'No tiene permisos para crear documentos de privacidad.');

  const seq = ctx.db.documents.filter((d) => d.companyId === ctx.company.id).length + 1;
  const reference = `DOC-PRI-${String(seq).padStart(2, '0')}`;

  const document: PrivacyDocument = {
    id: newId('doc'),
    companyId: ctx.company.id,
    reference,
    title,
    type,
    ownerId,
    reviewerId,
    lastReviewDate: null,
    nextReviewDate,
    linkedRopaIds,
    currentVersion: 1,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
  };

  const version: DocumentVersion = {
    id: newId('dver'),
    documentId: document.id,
    version: 1,
    status: 'draft',
    summaryOfChanges: 'Versión inicial.',
    effectiveDate: ctx.today,
    approvedBy: null,
    approvedAt: null,
    fileMetadata: {
      fileName: `${reference}_v1.pdf`,
      sizeBytes: 1024 * 45,
      mimeType: 'application/pdf',
    },
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('documents', document);
      tx.insert('documentVersions', version);
      tx.audit({
        action: 'document.created',
        entityType: 'PrivacyDocument',
        entityId: document.id,
        entityLabel: `${document.reference} · ${document.title}`,
        summary: `Creado documento ${document.reference} (versión 1 en borrador).`,
      });
      return { document, version };
    }
  );
}

export function createNewDocumentVersion(
  documentId: string,
  summaryOfChanges: string,
  effectiveDate: string
): DocumentVersion {
  const ctx = getServiceCtx();
  ctx.assert('documents.manage', 'No tiene permisos para crear nuevas versiones de documentos.');

  const doc = ctx.db.documents.find((d) => d.id === documentId && d.companyId === ctx.company.id);
  if (!doc) throw new NotFoundError('Documento no encontrado.');

  const nextVerNumber = doc.currentVersion + 1;
  const newVer: DocumentVersion = {
    id: newId('dver'),
    documentId: doc.id,
    version: nextVerNumber,
    status: 'in_review',
    summaryOfChanges,
    effectiveDate,
    approvedBy: null,
    approvedAt: null,
    fileMetadata: {
      fileName: `${doc.reference}_v${nextVerNumber}.pdf`,
      sizeBytes: 1024 * 52,
      mimeType: 'application/pdf',
    },
  };

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      tx.insert('documentVersions', newVer);
      tx.update('documents', doc.id, {
        currentVersion: nextVerNumber,
        updatedAt: nowInstant(),
      });
      tx.audit({
        action: 'document.version_created',
        entityType: 'PrivacyDocument',
        entityId: doc.id,
        entityLabel: `${doc.reference} · v${nextVerNumber}`,
        summary: `Creada versión v${nextVerNumber} de ${doc.reference}. La versión anterior aprobada se conserva intacta.`,
      });
      return newVer;
    }
  );
}

export function approveDocumentVersion(versionId: string): DocumentVersion {
  const ctx = getServiceCtx();
  ctx.assert('documents.approve', 'No tiene permisos para aprobar documentos de privacidad.');

  const ver = ctx.db.documentVersions.find((v) => v.id === versionId);
  if (!ver) throw new NotFoundError('Versión de documento no encontrada.');

  const doc = ctx.db.documents.find((d) => d.id === ver.documentId && d.companyId === ctx.company.id);
  if (!doc) throw new NotFoundError('Documento no encontrado.');

  return transact(
    { userId: ctx.user.id, name: ctx.user.name, role: ctx.roles[0] },
    ctx.company.id,
    (tx) => {
      // Supersede previous approved versions of the same document
      ctx.db.documentVersions
        .filter((v) => v.documentId === doc.id && v.id !== ver.id && v.status === 'approved')
        .forEach((oldVer) => {
          tx.update('documentVersions', oldVer.id, { status: 'superseded' });
        });

      const approved = tx.update('documentVersions', ver.id, {
        status: 'approved',
        approvedBy: ctx.user.id,
        approvedAt: nowInstant(),
      });

      tx.update('documents', doc.id, {
        lastReviewDate: ctx.today,
        updatedAt: nowInstant(),
      });

      tx.audit({
        action: 'document.version_approved',
        entityType: 'PrivacyDocument',
        entityId: doc.id,
        entityLabel: `${doc.reference} · v${ver.version}`,
        summary: `Aprobada versión v${ver.version} de ${doc.reference}. Versiones anteriores marcadas como sustituidas.`,
      });

      return approved;
    }
  );
}
