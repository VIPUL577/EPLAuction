// Google Sheets integration without API keys:
//  - READ: the sheet is shared "Anyone with the link can view" and fetched as CSV.
//  - WRITE: a tiny Google Apps Script Web App (docs/google-apps-script.gs) receives sold results.
import type { Config, Player } from './types.js';

export function toCsvUrl(url: string): string {
  const u = url.trim();
  if (!u) throw new Error('No Google Sheet link configured');
  if (/output=csv|format=csv/.test(u)) return u;
  const id = u.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  if (!id) throw new Error('That does not look like a Google Sheets link');
  const gid = u.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Turns a Google Drive share link into a directly embeddable, resized image URL. */
export function drivePhotoUrl(link: string): string {
  const l = (link || '').trim();
  if (!l) return '';
  const id = l.match(/\/d\/([a-zA-Z0-9_-]{10,})/)?.[1] ?? l.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1];
  if (id && /google\.com/.test(l)) return `https://lh3.googleusercontent.com/d/${id}=w600`;
  return l;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseMoney(raw: string): number {
  const s = (raw || '').toLowerCase();
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(/cr/.test(s) ? n * 100 : n);
}

export interface SheetImport {
  players: Player[];
  errors: string[];
}

/** Columns: 1 Sl No, 2 Name, 3 Photo (Drive link), 4 Category, 5 Base price (L), 6 Final team. */
export function rowsToPlayers(rows: string[][], config: Config): SheetImport {
  const errors: string[] = [];
  const players: Player[] = [];
  const seen = new Set<number>();
  for (const [idx, r] of rows.entries()) {
    const slNo = parseInt((r[0] || '').trim(), 10);
    if (!Number.isFinite(slNo)) {
      if (idx > 0) errors.push(`Row ${idx + 1}: missing Sl No, skipped`);
      continue; // header row
    }
    const name = (r[1] || '').trim();
    const catRaw = (r[3] || '').trim();
    const cat = config.categories.find((c) => norm(c.name) === norm(catRaw) || norm(c.id) === norm(catRaw));
    if (!name) {
      errors.push(`Row ${idx + 1}: missing name`);
      continue;
    }
    if (!cat) {
      errors.push(`Row ${idx + 1} (${name}): unknown category "${catRaw}"`);
      continue;
    }
    if (seen.has(slNo)) {
      errors.push(`Row ${idx + 1}: duplicate Sl No ${slNo}`);
      continue;
    }
    seen.add(slNo);
    players.push({
      id: `P${slNo}`,
      slNo,
      name,
      photo: drivePhotoUrl(r[2] || ''),
      categoryId: cat.id,
      basePrice: parseMoney(r[4] || '') || cat.basePrice,
      status: 'AVAILABLE',
      isCaptain: false,
    });
  }
  players.sort((a, b) => a.slNo - b.slNo);
  return { players, errors };
}

export async function fetchSheetPlayers(config: Config): Promise<SheetImport> {
  const res = await fetch(toCsvUrl(config.sheetUrl), { redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Google Sheet fetch failed (${res.status}). Is it shared "Anyone with the link"?`);
  const text = await res.text();
  if (/^\s*<!DOCTYPE html|<html/i.test(text)) {
    throw new Error('Google returned a login page. Share the sheet as "Anyone with the link can view".');
  }
  return rowsToPlayers(parseCsv(text), config);
}

export interface SheetRowUpdate {
  slNo: number;
  team: string;
  price: number | '';
}

/** Best effort: never throws, returns a warning string on failure. */
export async function pushToSheet(config: Config, rows: SheetRowUpdate[]): Promise<string | null> {
  if (!config.sheetWebhookUrl || rows.length === 0) return null;
  try {
    const res = await fetch(config.sheetWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: config.sheetWebhookSecret, rows }),
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    if (!res.ok || !/"ok"\s*:\s*true/.test(text)) return `Sheet update failed: ${text.slice(0, 120)}`;
    return null;
  } catch (e) {
    return `Sheet update failed: ${(e as Error).message}`;
  }
}
