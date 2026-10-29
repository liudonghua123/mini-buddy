#!/usr/bin/env node
// 重截聊天三张：chat（报告渲染）/ ask-card / process-log
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';

const BASE = 'http://127.0.0.1:8688';
const OUT = 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/docs/screenshots/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1800 });

  // 打开演示会话
  await p.eval(() => { [...document.querySelectorAll('.session-item')][0]?.click(); });
  await sleep(1500);
  // chat：滚到底部看报告渲染
  await p.screenshot({ path: OUT + 'chat.png' });
  console.log('chat ok');

  // ask-card：展开 m2 的过程日志，滚到 ask 卡
  await p.eval(async () => {
    // 展开第一条过程日志
    const toggles = [...document.querySelectorAll('.plog-toggle')];
    toggles[0]?.click();
    await new Promise(r => setTimeout(r, 500));
    // 滚到 ask 卡可见
    document.querySelector('.ask-card')?.scrollIntoView({ block: 'center' });
  });
  await sleep(500);
  await p.screenshot({ path: OUT + 'ask-card.png' });
  console.log('ask-card ok');

  // process-log：展开完整
  await p.eval(async () => {
    document.querySelector('.plog-body')?.scrollIntoView({ block: 'center' });
  });
  await sleep(400);
  await p.screenshot({ path: OUT + 'process-log.png' });
  console.log('process-log ok');
} finally {
  await b.close();
}
console.log('DONE');
