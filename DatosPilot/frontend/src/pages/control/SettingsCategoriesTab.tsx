import { FolderLock } from 'lucide-react';
import { Badge, Callout, Card, EmptyState, StatusBadge } from '../../components/ui';
import { ACCESS_CLASS } from '../../domain/status';
import type { AccessClass } from '../../domain/types';
import { t } from '../../i18n';
import { useCtx } from '../../store/hooks';

const CLASS_ORDER: AccessClass[] = ['ordinary', 'restricted', 'health', 'quarantined'];

/** Document categories and their access class (read-only in this phase). */
export function SettingsCategoriesTab() {
  const ctx = useCtx();
  const cats = ctx.db.categories.filter((c) => c.companyId === ctx.company.id);
  const docsIn = (id: string) => ctx.db.documents.filter((d) => d.companyId === ctx.company.id && d.categoryId === id).length;

  return (
    <div className="stack">
      <Callout tone="info" title={t('Solo lectura en esta fase')}>
        {t('Los tipos de documento y su clase de acceso están predefinidos. La clase de acceso decide quién puede ver cada documento; los documentos de salud nunca forman parte de los tipos generales y los informes clínicos no se guardan en el portal.')}
      </Callout>

      <Card flush title={<h2 className="row"><FolderLock size={16} aria-hidden /> {t('Tipos de documento')}</h2>}>
        {cats.length === 0 ? (
          <EmptyState icon={FolderLock} title={t('No hay tipos de documento configurados')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">{t('Tipos de documento')}</caption>
              <thead>
                <tr>
                  <th>{t('Tipo de documento')}</th>
                  <th>{t('Código')}</th>
                  <th>{t('Clase de acceso')}</th>
                  <th>{t('Quién puede verlo')}</th>
                  <th className="num">{t('Documentos')}</th>
                  <th>{t('Estado')}</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td className="small mono">{c.id}</td>
                    <td>
                      <StatusBadge meta={ACCESS_CLASS[c.accessClass]} />
                    </td>
                    <td className="small control-audit-text">{t(ACCESS_CLASS[c.accessClass].help)}</td>
                    <td className="num">{docsIn(c.id)}</td>
                    <td>{c.active ? <Badge tone="success">{t('Activo')}</Badge> : <Badge tone="neutral">{t('Inactivo')}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('Clases de acceso')}>
        <dl className="control-classes">
          {CLASS_ORDER.map((k) => (
            <div key={k}>
              <dt>
                <StatusBadge meta={ACCESS_CLASS[k]} />
              </dt>
              <dd className="small">{t(ACCESS_CLASS[k].help)}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
