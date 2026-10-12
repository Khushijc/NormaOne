/**
 * English dictionary, split by area so each part stays reviewable.
 * Keys are the exact Spanish source strings; `{name}` marks a placeholder.
 */
import { common } from './common';
import { shell } from './shell';
import { invoices } from './invoices';
import { invoiceScreens } from './invoiceScreens';
import { partiesExpenses } from './partiesExpenses';
import { operations } from './operations';
import { control } from './control';
import { settings } from './settings';

export const EN_PARTS: Record<string, Record<string, string>> = { common, shell, invoices, invoiceScreens, partiesExpenses, operations, control, settings };

export const EN: Record<string, string> = Object.assign({}, ...Object.values(EN_PARTS));
