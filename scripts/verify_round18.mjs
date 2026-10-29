#!/usr/bin/env node
// 第十八轮：助手能力绑定 / 设置页双列 / 分组头美化+新建清空
//  Q1 助手卡片有绑定摘要 pills（MCP/技能/知识库）
//  Q2 助手弹窗含三组绑定 chips（不限制 + 条目）
//  Q3 设置页 settings-grid 双列（无 560px 限制）
//  Q4 sgroup-head hover 显示新建/清空按钮
//  Q5 clear-assistant API 生效
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
const BASE = 'http://127.0.0.1:8688';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });

  // Q1 助手卡片绑定摘要
  await p.goto(BASE + '/?view=assistants', { settleMs: 1500 });
  const q1 = await p.eval(() => ({
    cards: document.querySelectorAll('.ast-card').length,
    pills: document.querySelectorAll('.ast-card .ast-binds .bind-pill').length,
    first: document.querySelector('.ast-card .ast-binds')?.textContent || '',
  }));
  ok('Q1 助手卡片绑定摘要', !!(q1.cards >= 6 && q1.pills >= q1.cards * 3), JSON.stringify(q1));

  // Q2 助手弹窗三组绑定（round19 起为搜索式选择器 bind-picker）
  const q2 = await p.eval(async () => {
    const btn = [...document.querySelectorAll('.ast-card .btn')].find(x => x.textContent.trim() === '编辑');
    btn?.click();
    await new Promise(r => setTimeout(r, 800));
    const groups = [...document.querySelectorAll('.modal .bind-picker')];
    const labels = [...document.querySelectorAll('.modal .field > label')].map(x => x.textContent.trim());
    return {
      groups: groups.length,
      allBtns: groups.map(g => !!g.querySelector('.bind-all')),
      searches: groups.map(g => !!g.querySelector('.bp-search')),
      hasMcpLabel: labels.some(l => l.includes('MCP')),
      hasDocLabel: labels.some(l => l.includes('知识库')),
    };
  });
  ok('Q2 助手弹窗三组绑定选择器', !!(q2.groups === 3 && q2.allBtns.every(Boolean) && q2.searches.every(Boolean) && q2.hasMcpLabel && q2.hasDocLabel), JSON.stringify(q2));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/q2-assistant-modal.png' });

  // Q3 设置页双列
  await p.goto(BASE + '/?view=settings', { settleMs: 1500 });
  const q3 = await p.eval(() => {
    const grid = document.querySelector('.settings-grid');
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    const card = document.querySelector('.settings-card');
    const w = card ? card.getBoundingClientRect().width : 0;
    return { grid: !!grid, cols, cardW: Math.round(w), maxW: card ? getComputedStyle(card).maxWidth : '' };
  });
  ok('Q3 设置页双列+无宽度限制', !!(q3.grid && q3.cols === 2 && q3.cardW > 400 && (q3.maxW === 'none' || parseFloat(q3.maxW) > 900)), JSON.stringify(q3));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/q3-settings-grid.png' });

  // Q4 sgroup-head hover 按钮
  await p.goto(BASE + '/', { settleMs: 1500 });
  const q4 = await p.eval(async () => {
    const head = document.querySelector('.sgroup-head');
    if (!head) return { head: false };
    head.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    head.classList.add('__hover_test');
    const actions = head.querySelector('.sgroup-actions');
    const style = actions ? getComputedStyle(actions) : null;
    return {
      head: true,
      hasNew: !!head.querySelector('.sgroup-btn:not(.danger)'),
      hasClear: !!head.querySelector('.sgroup-btn.danger'),
      display: style?.display || '',
    };
  });
  ok('Q4 组头新建/清空按钮', !!(q4.head && q4.hasNew && q4.hasClear), JSON.stringify(q4));

  // Q5 clear-assistant API
  const q5 = await p.eval(async () => {
    const as = await (await fetch('/api/assistants')).json();
    const aid = as[0].id;
    await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assistant_id: aid }) });
    const r = await (await fetch('/api/sessions/clear-assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assistant_id: aid }) })).json();
    return { ok: r.ok, removed: r.removed };
  });
  ok('Q5 clear-assistant API', !!(q5.ok && q5.removed >= 1), JSON.stringify(q5));
} finally {
  await b.close();
}
const pass = results.filter(r => r.pass).length;
console.log(`==== SUMMARY ${pass}/${results.length} PASS ====`);
if (pass < results.length) process.exit(1);
