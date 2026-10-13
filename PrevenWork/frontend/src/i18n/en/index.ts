/**
 * Combined English dictionary for PrevenWork.
 * Aggregates all modular dictionaries by domain area.
 */
import { common } from './common';
import { shell } from './shell';
import { overview } from './overview';
import { ropa } from './ropa';
import { rights } from './rights';
import { incidents } from './incidents';
import { documents } from './documents';
import { suppliers } from './suppliers';
import { retention } from './retention';
import { tasks } from './tasks';
import { reports } from './reports';
import { audit } from './audit';
import { settings } from './settings';

export const EN_PARTS: Record<string, Record<string, string>> = {
  common,
  shell,
  overview,
  ropa,
  rights,
  incidents,
  documents,
  suppliers,
  retention,
  tasks,
  reports,
  audit,
  settings,
};

export const enDictionary: Record<string, string> = Object.assign({}, ...Object.values(EN_PARTS));
export const EN = enDictionary;
