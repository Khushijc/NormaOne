import { Plus, Save, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Callout, Card, DateTimeText, Field, TextField, useAction } from '../../components/ui';
import { t } from '../../i18n';
import { userName } from '../../services/context';
import { updateSettings } from '../../services/opsService';
import { useCtx } from '../../store/hooks';

/** Product settings (alert window, share-link limit, quarantine keywords). None of them is a legal deadline. */
export function SettingsAlertsTab() {
  const ctx = useCtx();
  const s = ctx.settings;
  const [alertDays, setAlertDays] = useState(String(s.alertWindowDays));
  const [linkDays, setLinkDays] = useState(String(s.shareLinkMaxDays));
  const [keywords, setKeywords] = useState<string[]>(s.clinicalKeywords);
  const [newKeyword, setNewKeyword] = useState('');
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();

  const alertN = Number(alertDays);
  const linkN = Number(linkDays);
  const errors = {
    alert: !Number.isInteger(alertN) || alertN < 1 || alertN > 180 ? t('Entre 1 y 180 días (número entero).') : undefined,
    link: !Number.isInteger(linkN) || linkN < 1 || linkN > 90 ? t('Entre 1 y 90 días (número entero).') : undefined,
    keywords: keywords.filter((k) => k.trim()).length === 0 ? t('Mantenga al menos un término.') : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);
  const dirty = alertN !== s.alertWindowDays || linkN !== s.shareLinkMaxDays || keywords.join('|') !== s.clinicalKeywords.join('|');
  const canEdit = ctx.can('settings.manage');

  const addKeyword = () => {
    const k = newKeyword.trim();
    if (!k) return;
    if (!keywords.some((x) => x.toLowerCase() === k.toLowerCase())) setKeywords([...keywords, k]);
    setNewKeyword('');
  };

  const save = async () => {
    setTouched(true);
    if (invalid) return;
    const r = await run(() => updateSettings({ alertWindowDays: alertN, shareLinkMaxDays: linkN, clinicalKeywords: keywords }), t('Configuración guardada'));
    if (r) {
      setKeywords(r.clinicalKeywords);
      setTouched(false);
    }
  };

  const reset = () => {
    setAlertDays(String(s.alertWindowDays));
    setLinkDays(String(s.shareLinkMaxDays));
    setKeywords(s.clinicalKeywords);
    setNewKeyword('');
    setTouched(false);
  };

  return (
    <div className="stack">
      <Callout tone="info" title={t('Valores del producto, no plazos legales')}>
        {t('Estos valores solo deciden cuándo avisa DatosPilot y cuánto duran los enlaces de demostración. No modifican la caducidad legal de ningún documento ni las fechas fijadas por el servicio de prevención.')}
      </Callout>

      <form
        className="stack"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid-2">
          <Card title={t('Avisos de fechas')}>
            <TextField
              label={t('Ventana de aviso (días)')}
              type="number"
              min={1}
              max={180}
              step={1}
              inputMode="numeric"
              required
              value={alertDays}
              disabled={!canEdit}
              onChange={(e) => setAlertDays(e.target.value)}
              error={touched ? errors.alert : undefined}
              hint={t('Días antes de una caducidad legal, revisión del proveedor o seguimiento interno real en los que el elemento aparece como «próximo». Si un documento no tiene fecha, no se inventa ninguna.')}
            />
          </Card>
          <Card title={t('Enlaces de acceso CAE (simulados)')}>
            <TextField
              label={t('Caducidad máxima de los enlaces (días)')}
              type="number"
              min={1}
              max={90}
              step={1}
              inputMode="numeric"
              required
              value={linkDays}
              disabled={!canEdit}
              onChange={(e) => setLinkDays(e.target.value)}
              error={touched ? errors.link : undefined}
              hint={t('Límite para los enlaces de solo lectura que se comparten con empresas concurrentes. Los enlaces se pueden revocar en cualquier momento.')}
            />
          </Card>
        </div>

        <Card title={t('Términos de detección de contenido clínico (cuarentena)')}>
          <div className="stack-sm">
            <p className="small">
              {t('Si el título, el nombre del archivo o la descripción de un documento contienen alguno de estos términos, el documento va a cuarentena y no se incorpora al expediente hasta que lo gestione el personal sanitario.')}
            </p>
            <Field label={t('Términos actuales')} error={touched ? errors.keywords : undefined}>
              {keywords.length === 0 ? (
                <span className="small muted">{t('Ningún término configurado')}</span>
              ) : (
                <ul className="control-chips" aria-label={t('Términos actuales')}>
                  {keywords.map((k) => (
                    <li key={k} className="chip">
                      <span>{k}</span>
                      {canEdit && (
                        <button type="button" aria-label={t('Quitar el término «{term}»', { term: k })} onClick={() => setKeywords(keywords.filter((x) => x !== k))}>
                          <X size={12} aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Field>
            {canEdit && (
              <div className="row-wrap control-add-row">
                <TextField
                  label={t('Añadir término')}
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  placeholder={t('p. ej., informe médico')}
                />
                <Button icon={Plus} onClick={addKeyword} disabled={!newKeyword.trim()}>
                  {t('Añadir')}
                </Button>
              </div>
            )}
            <p className="tiny muted">{t('Es una comprobación de demostración por palabras clave: no detecta de forma fiable todo el contenido clínico. Nunca suba informes médicos al portal.')}</p>
          </div>
        </Card>

        <div className="row-wrap between">
          <span className="tiny muted">
            {s.updatedAt ? (
              <>
                {t('Última modificación: {user}', { user: userName(ctx.db, s.updatedBy) })} · <DateTimeText at={s.updatedAt} tz={ctx.company.timezone} />
              </>
            ) : (
              t('Valores iniciales de la demostración (sin modificaciones).')
            )}
          </span>
          {canEdit && (
            <span className="row-wrap">
              <Button onClick={reset} disabled={!dirty || pending}>
                {t('Descartar cambios')}
              </Button>
              <Button type="submit" variant="primary" icon={Save} loading={pending} disabled={!dirty}>
                {t('Guardar cambios')}
              </Button>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
