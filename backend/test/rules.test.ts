import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultConfig, defaultTeams } from '../src/core/defaults.js';
import { maxBidFor, nextBid, reserveRequired } from '../src/core/rules.js';
import { drivePhotoUrl, parseCsv, parseMoney, rowsToPlayers, toCsvUrl } from '../src/core/sheet.js';

const ladder = { threshold: 200, stepLow: 10, stepHigh: 20 };

test('bid ladder: +10 below 2 Cr, +20 from 2 Cr', () => {
  assert.equal(nextBid(null, 90, ladder), 90);
  assert.equal(nextBid(190, 90, ladder), 200);
  assert.equal(nextBid(200, 90, ladder), 220);
  assert.equal(nextBid(220, 90, ladder), 240);
});

test('bid ladder continues from non-multiples of 10', () => {
  assert.equal(nextBid(85, 85, ladder), 95);
  assert.equal(nextBid(195, 85, ladder), 205);
  assert.equal(nextBid(205, 85, ladder), 225);
});

test('wallet reserve = 2x base of every unfilled category except the one being bought', () => {
  const config = defaultConfig();
  const team = defaultTeams()[0];
  const all = config.categories.reduce((s, c) => s + c.basePrice, 0); // 510
  assert.equal(reserveRequired(team, config), all * 2);
  assert.equal(reserveRequired(team, config, 'AR1'), (all - 90) * 2);
  assert.equal(maxBidFor(team, config, 'AR1'), 1800 - (all - 90) * 2);
});

test('csv parsing handles quotes, commas and CRLF', () => {
  const rows = parseCsv('Sl,Name\r\n1,"Doe, John"\r\n2,"Say ""hi"""\n');
  assert.deepEqual(rows, [['Sl', 'Name'], ['1', 'Doe, John'], ['2', 'Say "hi"']]);
});

test('sheet helpers', () => {
  assert.equal(
    toCsvUrl('https://docs.google.com/spreadsheets/d/abc123_-XYZ/edit#gid=42'),
    'https://docs.google.com/spreadsheets/d/abc123_-XYZ/export?format=csv&gid=42',
  );
  assert.equal(drivePhotoUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing'), 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMn=w600');
  assert.equal(parseMoney('₹90 L'), 90);
  assert.equal(parseMoney('1.2 Cr'), 120);
  const { players, errors } = rowsToPlayers(
    [
      ['Sl No', 'Name', 'Photo', 'Category', 'Base', 'Team'],
      ['1', 'Ravi', '', 'All-rounder 1', '90', ''],
      ['2', 'Amit', '', 'impact player 3', '', ''],
      ['3', 'Bad', '', 'Wicketkeeper', '50', ''],
    ],
    defaultConfig(),
  );
  assert.equal(players.length, 2);
  assert.equal(players[1].categoryId, 'IMP3');
  assert.equal(players[1].basePrice, 20);
  assert.equal(errors.length, 1);
});
