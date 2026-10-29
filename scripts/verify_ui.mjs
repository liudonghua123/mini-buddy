#!/usr/bin/env node
// Mini Buddy（Vite+React）端到端验证 — AgentScope 版。
//  A. 技能查看弹窗：Monaco 加载、目录树、文件切换
//  B. 聊天流式回复 + 图表渲染：mermaid SVG + echarts canvas
//  C. composer 工具条：cap-pop 开关、pick-bar chips、消息 attachments chips
//  D. 助手视图 + 会话设置抽屉：助手卡片、身份切换、温度滑杆、能力开关
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8688';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  const errors = [];
  p.browser.on(p.sessionId, 'Runtime.exceptionThrown', (ev) => {
    errors.push((ev.exceptionDetails?.exception?.description || '').slice(0, 200));
  });

  // ---------- A. 技能编辑器 ----------
  await p.goto(BASE + '/?view=skills', { settleMs: 1500 });
  await p.eval(() => document.querySelector('.skill-card .card-foot .btn-ghost')?.click());
  let a1 = null;
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    a1 = await p.eval(() => ({
      mono: !!document.querySelector('.modal .skill-mono-wrap .monaco-editor'),
      tree: document.querySelectorAll('.modal .skill-tree .tree-item').length,
      lines: (document.querySelector('.modal .monaco-editor .view-lines')?.textContent || '').replace(/\s/g, '').length,
    })).catch(() => null);
    if (a1 && a1.mono && a1.tree > 0 && a1.lines > 10) break;
  }
  ok('A1 弹窗+Monaco 加载+SKILL.md 渲染', !!(a1 && a1.mono && a1.tree > 0 && a1.lines > 10), JSON.stringify(a1));
  await p.screenshot({ path: OUT + '/a1-skill-editor.png' });

  const a3 = await p.eval(async () => {
    const items = [...document.querySelectorAll('.modal .skill-tree .tree-item')];
    if (items.length < 2) return { skip: 'files=' + items.length };
    items[1].click();
    await new Promise(r => setTimeout(r, 1200));
    return {
      sel: document.querySelector('.modal .skill-tree .tree-item.sel')?.textContent.trim() || null,
      len: (document.querySelector('.modal .monaco-editor .view-lines')?.textContent || '').replace(/\s/g, '').length,
    };
  });
  ok('A3 目录树切换文件', !!(a3 && !a3.skip && a3.len > 0 && a3.sel), JSON.stringify(a3));
  await p.eval(() => [...document.querySelectorAll('.modal .btn-primary')].find(x => x.textContent === '完成')?.click());
  await sleep(300);

  // ---------- D. 助手视图 ----------
  await p.goto(BASE + '/?view=assistants', { settleMs: 1500 });
  const d1 = await p.eval(() => ({
    cards: document.querySelectorAll('.ast-card').length,
    builtinPills: [...document.querySelectorAll('.ast-card .pill')].filter(x => x.textContent === '内置').length,
    names: [...document.querySelectorAll('.ast-card .c-name')].slice(0, 6).map(x => x.textContent.trim()),
  }));
  ok('D1 助手视图卡片', d1.cards >= 6 && d1.builtinPills >= 6, JSON.stringify(d1));
  await p.screenshot({ path: OUT + '/d1-assistants.png' });

  // ---------- B. 聊天：流式 + 图表 ----------
  await p.goto(BASE + '/', { settleMs: 1500 });
  await p.eval(() => document.querySelector('.new-chat')?.click());
  await sleep(1200);
  const b0 = await p.eval(() => ({
    chips: [...document.querySelectorAll('.composer-sugs .quick-chip')].map(x => x.textContent.trim()),
    input: !!document.querySelector('.composer textarea'),
    toolBtn: !!document.querySelector('.cap-picker'),
    settingsBtn: !!document.querySelector('.chat-head .btn-secondary'),
  }));
  ok('B0 composer 工具条+会话设置按钮+快捷提示', b0.chips.length > 0 && b0.input && b0.toolBtn && b0.settingsBtn, JSON.stringify(b0.chips.slice(0, 2)));

  async function sendAndRender(text) {
    return p.eval(async (text) => {
      const ta = document.querySelector('.composer textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      document.querySelector('.btn-send').click();
      for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 300)); if (!document.querySelector('#typing-msg')) break; }
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const charts = [...document.querySelectorAll('[data-chart]')];
        const last = charts[charts.length - 1];
        if (last && (last.querySelector('svg') || last.querySelector('canvas') || last.classList.contains('chart-err'))) {
          return {
            chartCount: charts.length, kind: last.dataset.chart,
            hasSvg: !!last.querySelector('svg'), hasCanvas: !!last.querySelector('canvas'),
            isErr: last.classList.contains('chart-err'),
            box: (() => { const el = last.querySelector('svg') || last.querySelector('canvas'); if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })(),
          };
        }
      }
      const charts = [...document.querySelectorAll('[data-chart]')];
      return { chartCount: charts.length, kind: charts[charts.length - 1]?.dataset.chart || null, hasSvg: false, hasCanvas: false };
    }, text);
  }

  const b1 = await sendAndRender('用 mermaid 代码块画一个登录流程图（graph TD，含判断节点）。直接输出代码，不要反问。');
  ok('B1 mermaid 客户端渲染为 SVG', !!(b1.chartCount >= 1 && b1.kind === 'mermaid' && b1.hasSvg), JSON.stringify(b1));
  await p.screenshot({ path: OUT + '/b1-mermaid.png' });

  const b2 = await sendAndRender('来个柱状图看看');
  ok('B2 echarts 客户端渲染为 canvas', !!(b2.chartCount >= 1 && b2.kind === 'echarts' && b2.hasCanvas), JSON.stringify(b2));
  await p.screenshot({ path: OUT + '/b2-echarts.png' });

  // ---------- C. composer 工具条：两层能力选择 ----------
  // 注意：本轮新增的上传按钮也叫 cap-picker，工具选择器靠 aria-label 区分
  const c1 = await p.eval(async () => {
    [...document.querySelectorAll('.cap-picker')].find(x => x.getAttribute('aria-label')?.includes('MCP 和技能'))?.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      popOpen: !!document.querySelector('.cap-pop'),
      catItems: [...document.querySelectorAll('.cap-pop .cat-item .cat-name')].map(x => x.textContent.trim()),
      counts: [...document.querySelectorAll('.cap-pop .cat-count')].map(x => x.textContent.trim()),
    };
  });
  ok('C1 第一层分类入口（MCP/技能 + 数量）', !!(c1.popOpen && c1.catItems.length === 2 && c1.catItems.includes('MCP 服务器') && c1.catItems.includes('技能')), JSON.stringify(c1));
  await p.screenshot({ path: OUT + '/c1-cap-pop.png' });

  // 进入 MCP 层 → 搜索过滤 → 勾选第一个
  const c1b = await p.eval(async () => {
    [...document.querySelectorAll('.cap-pop .cat-item')].find(x => x.textContent.includes('MCP 服务器'))?.click();
    await new Promise(r => setTimeout(r, 350));
    const head = document.querySelector('.cap-pop .cap-pop-head')?.textContent.trim() || '';
    const listCount = document.querySelectorAll('.cap-pop .cp-item').length;
    const hasBack = !!document.querySelector('.cap-pop .cp-back');
    const hasSearch = !!document.querySelector('.cap-pop .search-box input');
    // 输入一个必不匹配的关键词验证过滤
    const inp = document.querySelector('.cap-pop .search-box input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'zzz-不存在的服务器');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const emptyShown = (document.querySelector('.cap-pop .cp-empty')?.textContent || '').includes('没有匹配');
    setter.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return { head, listCount, hasBack, hasSearch, emptyShown };
  });
  ok('C1b 第二层 MCP 列表（返回+搜索+过滤）', !!(c1b.head.includes('MCP 服务器') && c1b.listCount >= 2 && c1b.hasBack && c1b.hasSearch && c1b.emptyShown), JSON.stringify(c1b));

  const c2 = await p.eval(async () => {
    // 勾选第一个 MCP（跟随模式下首次点击 → 进入显式模式，集合=全部生效能力）
    [...document.querySelectorAll('.cap-pop .cp-item .sw')][0]?.click();
    await new Promise(r => setTimeout(r, 250));
    // 返回分类层 → 进入技能层 → 关掉最后一个技能
    document.querySelector('.cap-pop .cp-back')?.click();
    await new Promise(r => setTimeout(r, 250));
    [...document.querySelectorAll('.cap-pop .cat-item')].find(x => x.textContent.includes('技能'))?.click();
    await new Promise(r => setTimeout(r, 300));
    const sws = [...document.querySelectorAll('.cap-pop .cp-item .sw')];
    sws[sws.length - 1]?.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      chips: [...document.querySelectorAll('.pick-bar .pick-chip')].map(c => c.textContent.trim()),
      badge: document.querySelector('.cap-picker.active .cp-badge')?.textContent || null,
      followNote: [...document.querySelectorAll('.cap-pop .cap-pop-note')].map(x => x.textContent).join(''),
    };
  });
  // 新语义：首次点开关 → 显式模式初始=全部生效；chips 显示显式集合；badge=显式集合总数
  ok('C2 两层勾选后 pick-bar chips + 角标', c2.chips.length >= 2 && c2.badge !== null, JSON.stringify(c2));
  await p.screenshot({ path: OUT + '/c2-picked.png' });

  // 关闭 popover（点外部）
  await p.eval(async () => {
    document.querySelector('.chat-head h1')?.click();
    await new Promise(r => setTimeout(r, 300));
  });

  const c3 = await p.eval(async () => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '1+1等于几');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    document.querySelector('.btn-send').click();
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 300)); if (!document.querySelector('#typing-msg')) break; }
    await new Promise(r => setTimeout(r, 800));
    const users = [...document.querySelectorAll('.msg.msg-user')];
    const user = users[users.length - 1];
    return {
      attach: [...(user?.querySelectorAll('.msg-attach .pick-chip') || [])].map(c => c.textContent.trim()),
      reply: (user?.nextElementSibling?.textContent || '').slice(0, 60),
    };
  });
  ok('C3 消息带能力 chips 且获得回复', !!(c3.attach.length >= 2 && c3.reply), JSON.stringify(c3));
  await p.screenshot({ path: OUT + '/c3-sent.png' });

  // ---------- D2. 会话设置抽屉 ----------
  const d2 = await p.eval(async () => {
    document.querySelector('.chat-head .btn-secondary').click();
    for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 200)); if (document.querySelector('.drawer')) break; }
    return {
      drawer: !!document.querySelector('.drawer'),
      astChips: document.querySelectorAll('.drawer .ast-chip').length,
      tempSlider: !!document.querySelector('.drawer input[type="range"]'),
      capRows: document.querySelectorAll('.drawer .cap-row').length,
      promptBox: !!document.querySelector('.drawer .drawer-textarea'),
    };
  });
  ok('D2 会话设置抽屉元素齐全', !!(d2.drawer && d2.astChips >= 6 && d2.tempSlider && d2.capRows >= 4 && d2.promptBox), JSON.stringify(d2));
  await p.screenshot({ path: OUT + '/d2-drawer.png' });

  const d3 = await p.eval(async () => {
    // 切换到全栈工程师身份
    const chip = [...document.querySelectorAll('.drawer .ast-chip')].find(x => x.textContent.includes('全栈工程师'));
    chip?.click();
    await new Promise(r => setTimeout(r, 800));
    const headPersona = document.querySelector('.head-persona')?.textContent.trim() || null;
    // 关抽屉
    document.querySelector('.drawer-head .btn-icon')?.click();
    await new Promise(r => setTimeout(r, 300));
    return { headPersona };
  });
  ok('D3 切换助手身份生效（头部徽标）', !!(d3.headPersona && d3.headPersona.includes('全栈工程师')), JSON.stringify(d3));

  // 还原身份为默认
  await p.eval(async () => {
    document.querySelector('.chat-head .btn-secondary')?.click();
    await new Promise(r => setTimeout(r, 400));
    const chip = [...document.querySelectorAll('.drawer .ast-chip')].find(x => x.textContent.includes('默认'));
    chip?.click();
    await new Promise(r => setTimeout(r, 600));
    document.querySelector('.drawer-head .btn-icon')?.click();
  });

  // ---------- E. 管理页搜索 ----------
  await p.goto(BASE + '/?view=mcp', { settleMs: 1500 });
  const e1 = await p.eval(async () => {
    const inp = document.querySelector('.view-head .search-box input');
    if (!inp) return { noSearch: true };
    const total = document.querySelectorAll('.card-grid .card').length;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'zzz-不存在');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const emptyTitle = document.querySelector('.empty-block .ec-title')?.textContent || '';
    setter.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const restored = document.querySelectorAll('.card-grid .card').length;
    return { total, emptyTitle, restored };
  });
  ok('E1 MCP 页搜索过滤', !!(e1.total >= 1 && e1.emptyTitle.includes('没有匹配') && e1.restored === e1.total), JSON.stringify(e1));
  await p.screenshot({ path: OUT + '/e1-mcp-search.png' });

  await p.goto(BASE + '/?view=skills', { settleMs: 1500 });
  const e2 = await p.eval(async () => {
    const inp = document.querySelector('.view-head .search-box input');
    if (!inp) return { noSearch: true };
    const total = document.querySelectorAll('.card-grid .card').length;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'zzz-不存在');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const emptyTitle = document.querySelector('.empty-block .ec-title')?.textContent || '';
    // 用真实 slug 搜索应命中 ≥1
    const firstSlug = (document.querySelector('.card-grid .card-meta')?.textContent || '').split(' · ')[0];
    setter.call(inp, firstSlug);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    const hit = document.querySelectorAll('.card-grid .card').length;
    setter.call(inp, '');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return { total, emptyTitle, firstSlug, hit };
  });
  ok('E2 技能页搜索过滤+命中', !!(e2.total >= 1 && e2.emptyTitle.includes('没有匹配') && e2.hit >= 1), JSON.stringify(e2));

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally {
  await b.close();
}
