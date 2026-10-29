#!/usr/bin/env node
// 目检截图：折叠侧栏 / 分组侧栏 / 移动端 header
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
const OUT = 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify';
const BASE = 'http://127.0.0.1:8688';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });
  await p.screenshot({ path: OUT + '/r11-sidebar-groups.png' });
  await p.eval(() => document.querySelector('.sidebar .sb-toggle')?.click());
  await sleep(700);
  await p.screenshot({ path: OUT + '/r11-sidebar-collapsed.png' });
  await p.eval(() => document.querySelector('.sidebar .sb-toggle')?.click());
  await sleep(400);
  const pm = await b.newPage({ width: 390, height: 844 });
  await pm.goto(BASE + '/', { settleMs: 1500 });
  await pm.screenshot({ path: OUT + '/r11-mobile-head.png' });
  console.log('done');
} finally { await b.close(); }
