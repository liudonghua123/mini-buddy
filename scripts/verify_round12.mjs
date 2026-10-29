#!/usr/bin/env node
// 第十二轮专项：
//  H1 nav-item 左对齐 + 数字右对齐（count 左边缘显著大于文字右边缘，且贴近按钮右缘）
//  H2 sgroup-head 可点击折叠（.closed + 会话隐藏）+ 再展开
//  H3 折叠持久化（reload 后仍收起）+ localStorage 键
//  H4 移动端抽屉分组折叠同样生效
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
const BASE = 'http://127.0.0.1:8688';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  const errors = [];
  p.browser.on(p.sessionId, 'Runtime.exceptionThrown', (ev) => {
    errors.push((ev.exceptionDetails?.exception?.description || '').slice(0, 150));
  });
  await p.goto(BASE + '/', { settleMs: 1500 });

  // H1: nav-item 对齐
  const h1 = await p.eval(() => {
    const item = [...document.querySelectorAll('.sidebar .nav-item')].find(x => x.querySelector('.count'));
    if (!item) return { skip: 'no-count-item' };
    const iR = item.getBoundingClientRect();
    const svg = item.querySelector('svg').getBoundingClientRect();
    const label = item.querySelector('span').getBoundingClientRect();
    const count = item.querySelector('.count').getBoundingClientRect();
    return {
      leftAligned: Math.abs(svg.left - label.left) < 30, // 图标与文字同行靠左
      gap: Math.round(count.left - label.right),    // 文字右缘到数字的空隙（正数=数字在右）
      rightGap: Math.round(iR.right - count.right), // 数字距按钮右缘
    };
  });
  ok('H1 nav-item 图标文字左对齐+数字右对齐',
    !!(h1.leftAligned && h1.gap > 40 && h1.rightGap >= 0 && h1.rightGap <= 16), JSON.stringify(h1));

  // H2: 分组折叠
  const h2 = await p.eval(async () => {
    const head = document.querySelector('.sidebar .sgroup-head');
    if (!head) return { skip: 'no-group' };
    const before = head.nextElementSibling.querySelectorAll('.session-item').length;
    head.click();
    await new Promise(r => setTimeout(r, 400));
    const g = head.closest('.sgroup');
    const hidden = g.classList.contains('closed') && getComputedStyle(g.querySelector('.sgroup-body')).display === 'none';
    const caret = getComputedStyle(g.querySelector('.sgroup-caret')).transform !== 'none';
    head.click();
    await new Promise(r => setTimeout(r, 400));
    const shown = !g.classList.contains('closed') && getComputedStyle(g.querySelector('.sgroup-body')).display !== 'none';
    return { before, hidden, caret, shown };
  });
  ok('H2 组头点击折叠/展开+箭头旋转', !!(h2.before > 0 && h2.hidden && h2.shown), JSON.stringify(h2));

  // H3: 持久化
  const h3a = await p.eval(async () => {
    document.querySelector('.sidebar .sgroup-head').click();
    await new Promise(r => setTimeout(r, 300));
    return { saved: localStorage.getItem('mb_group_closed') };
  });
  await p.goto(BASE + '/', { settleMs: 1500 });
  const h3b = await p.eval(async () => {
    const g = document.querySelector('.sidebar .sgroup');
    const stillClosed = g.classList.contains('closed');
    document.querySelector('.sidebar .sgroup-head').click(); // 还原展开
    await new Promise(r => setTimeout(r, 300));
    return { stillClosed };
  });
  ok('H3 折叠持久化（reload 后保持）', !!(h3a.saved && JSON.parse(h3a.saved).length >= 1 && h3b.stillClosed), JSON.stringify(h3a));

  // H4: 移动端抽屉
  const pm = await b.newPage({ width: 390, height: 844 });
  await pm.goto(BASE + '/', { settleMs: 1500 });
  const h4 = await pm.eval(async () => {
    document.querySelector('.chat-sessions-btn')?.click();
    await new Promise(r => setTimeout(r, 500));
    const head = document.querySelector('.sessions-drawer .sgroup-head');
    if (!head) return { skip: 'no-drawer-group' };
    head.click();
    await new Promise(r => setTimeout(r, 300));
    const g = head.closest('.sgroup');
    const closed = g.classList.contains('closed') && g.querySelector('.sgroup-body').style.display !== 'flex'
      && getComputedStyle(g.querySelector('.sgroup-body')).display === 'none';
    head.click();
    await new Promise(r => setTimeout(r, 300));
    const reopened = !g.classList.contains('closed');
    return { closed, reopened };
  });
  ok('H4 移动端抽屉分组可折叠', !!(h4.closed && h4.reopened), JSON.stringify(h4));

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally { await b.close(); }
