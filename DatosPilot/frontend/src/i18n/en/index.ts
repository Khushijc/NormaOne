/**
 * English dictionary, split by area so each part stays reviewable.
 * Keys are the exact Spanish source strings; `{name}` marks a placeholder and a trailing
 * " [context]" disambiguates one Spanish word with two English meanings.
 */
import { common } from './common';
import { domain } from './domain';
import { shell } from './shell';
import { reference } from './reference';
import { home } from './home';
import { requirements } from './requirements';
import { people } from './people';
import { evidence } from './evidence';
import { safety } from './safety';
import { cae } from './cae';
import { health } from './health';
import { control } from './control';

export const EN_PARTS: Record<string, Record<string, string>> = { common, domain, shell, reference, home, requirements, people, evidence, safety, cae, health, control };

export const EN: Record<string, string> = Object.assign({}, ...Object.values(EN_PARTS));
