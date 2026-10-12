/**
 * English dictionary, split by area so each part stays reviewable.
 * Keys are the exact Spanish source strings; `{name}` marks a placeholder and a trailing
 * " [context]" disambiguates one Spanish word with two English meanings.
 */
import { common } from './common';
import { shell } from './shell';
import { time } from './time';
import { absences } from './absences';
import { corrections } from './corrections';
import { team } from './team';
import { control } from './control';
import { home } from './home';
import { planning } from './planning';
import { reference } from './reference';

export const EN_PARTS: Record<string, Record<string, string>> = { common, shell, home, time, absences, corrections, team, planning, control, reference };

export const EN: Record<string, string> = Object.assign({}, ...Object.values(EN_PARTS));
