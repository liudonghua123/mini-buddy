#!/usr/bin/env node
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
const OUT = 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify';
const BASE = 'http://127.0.0.1:8688';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });
  await p.eval(() => localStorage.removeItem('mb_group_closed'));
  await p.goto(BASE + '/', { settleMs: 1200 });
  await p.screenshot({ path: OUT + '/r12-groups-open.png' });
  await p.eval(() => document.querySelector('.sidebar .sgroup-head')?.click());
  await sleep(400);
  await p.screenshot({ path: OUT + '/r12-group-closed.png' });
  await p.eval(() => localStorage.removeItem('mb_group_closed'));
  console.log('done');
} finally { await b.close(); }
