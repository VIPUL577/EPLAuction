/**
 * EPL Auction -> Google Sheet write-back.
 *
 * Setup (once, by the master admin):
 *  1. Open the player sheet > Extensions > Apps Script. Paste this file. Set SECRET below.
 *  2. Deploy > New deployment > type "Web app".
 *     Execute as: Me.  Who has access: Anyone.   -> Deploy, authorise, copy the /exec URL.
 *  3. In the auction Setup tab paste the URL and the same secret, then Save settings.
 *
 * Columns: A Sl No | B Name | C Photo | D Category | E Base price | F Final team | G Sold price (written by this script)
 */
const SECRET = 'change-me-to-a-long-random-string';
const SHEET_NAME = ''; // leave empty to use the first sheet

function doPost(e) {
  const out = (obj) => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return out({ ok: false, error: 'bad secret' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const last = sheet.getLastRow();
      const slNos = sheet.getRange(1, 1, last, 1).getValues().map((r) => String(r[0]).trim());
      let updated = 0;
      (body.rows || []).forEach((row) => {
        const idx = slNos.indexOf(String(row.slNo));
        if (idx === -1) return;
        sheet.getRange(idx + 1, 6, 1, 2).setValues([[row.team || '', row.price === '' ? '' : row.price]]);
        updated++;
      });
      return out({ ok: true, updated: updated });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}
