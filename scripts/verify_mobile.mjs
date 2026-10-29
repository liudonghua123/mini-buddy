#!/usr/bin/env node
// 移动端响应式验证：底部导航、会话抽屉、MCP/技能管理可达、版本面板
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
import { mkdirSync } from 'node:fs';

const OUT = 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8688';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await Browser.launch({ width: 390, height: 844 });
try {
  const p = await b.newPage({ width: 390, height: 844 });
  const errors = [];
  p.browser.on(p.sessionId, 'Runtime.exceptionThrown', (ev) => {
    errors.push((ev.exceptionDetails?.exception?.description || '').slice(0, 150));
  });

  // 1. 首屏：底部导航显示、桌面侧栏隐藏
  await p.goto(BASE + '/', { settleMs: 1500 });
  const m1 = await p.eval(() => ({
    mobileNav: !!document.querySelector('.mobile-nav'),
    sidebarHidden: getComputedStyle(document.querySelector('.sidebar')).display === 'none',
    tabs: [...document.querySelectorAll('.mnav-item span')].map(x => x.textContent),
    noHScroll: document.documentElement.scrollWidth <= 391,
  }));
  ok('M1 底部导航+侧栏隐藏+无横向滚动', !!(m1.mobileNav && m1.sidebarHidden && m1.tabs.length === 7 && m1.noHScroll), JSON.stringify(m1));
  await p.screenshot({ path: OUT + '/m1-home.png' });

  // 2. 底部导航切换到 MCP 视图 → 可安装/管理
  const m2 = await p.eval(async () => {
    [...document.querySelectorAll('.mnav-item')].find(x => x.textContent.includes('MCP'))?.click();
    await new Promise(r => setTimeout(r, 800));
    return {
      view: location.search.includes('mcp') || !!document.querySelector('.card-grid'),
      cards: document.querySelectorAll('.card-grid .card').length,
      installBtn: [...document.querySelectorAll('button')].some(x => x.textContent.includes('安装 MCP')),
      search: !!document.querySelector('.view-head .search-box input'),
    };
  });
  ok('M2 底部导航进 MCP 页可管理', !!(m2.cards >= 1 && m2.installBtn && m2.search), JSON.stringify(m2));
  await p.screenshot({ path: OUT + '/m2-mcp.png' });

  // 3. 技能页 → 打开编辑器 → 版本历史面板
  await p.eval(async () => {
    [...document.querySelectorAll('.mnav-item')].find(x => x.textContent.includes('技能'))?.click();
    await new Promise(r => setTimeout(r, 800));
    [...document.querySelectorAll('.card-foot .btn-ghost')].find(x => x.textContent === '查看')?.click();
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (document.querySelector('.modal .monaco-editor')) break;
    }
  });
  const m3 = await p.eval(async () => {
    [...document.querySelectorAll('.modal .modal-actions .btn-ghost')].find(x => x.textContent === '版本历史')?.click();
    await new Promise(r => setTimeout(r, 800));
    return {
      panel: !!document.querySelector('.ver-panel'),
      items: document.querySelectorAll('.ver-item').length,
      rollbackBtns: [...document.querySelectorAll('button')].filter(x => x.textContent === '回滚此版本').length,
    };
  });
  ok('M3 技能编辑器+版本面板', !!(m3.panel && m3.items >= 1 && m3.rollbackBtns >= 1), JSON.stringify(m3));
  await p.screenshot({ path: OUT + '/m3-versions.png' });

  // 4. 会话抽屉：chat 视图头部按钮打开
  await p.eval(async () => {
    document.querySelector('.modal-actions .btn-primary')?.click(); // 关编辑器
    await new Promise(r => setTimeout(r, 400));
    [...document.querySelectorAll('.mnav-item')].find(x => x.textContent.includes('会话'))?.click();
    await new Promise(r => setTimeout(r, 600));
    document.querySelector('.chat-sessions-btn')?.click();
    await new Promise(r => setTimeout(r, 500));
  });
  const m4 = await p.eval(() => ({
    drawer: !!document.querySelector('.sessions-drawer'),
    newBtn: !!document.querySelector('.sessions-drawer .new-chat'),
    items: document.querySelectorAll('.sessions-drawer .session-item').length,
  }));
  ok('M4 会话抽屉（新建+列表）', !!(m4.drawer && m4.newBtn), JSON.stringify(m4));
  await p.screenshot({ path: OUT + '/m4-drawer.png' });

  // 5. 设置页清空按钮 + 危险确认
  await p.eval(async () => {
    document.querySelector('.drawer-mask')?.click();
    await new Promise(r => setTimeout(r, 300));
    [...document.querySelectorAll('.mnav-item')].find(x => x.textContent.includes('设置'))?.click();
    await new Promise(r => setTimeout(r, 800));
  });
  const m5 = await p.eval(async () => {
    const btn = [...document.querySelectorAll('button')].find(x => x.textContent === '清空会话数据');
    btn?.click();
    await new Promise(r => setTimeout(r, 600));
    return {
      btn: !!btn,
      confirm: !!document.querySelector('.modal'),
      confirmTitle: document.querySelector('.modal-title')?.textContent || '',
    };
  });
  ok('M5 设置页清空入口+确认弹窗', !!(m5.btn && m5.confirm && m5.confirmTitle === '清空会话数据'), JSON.stringify(m5));
  await p.eval(async () => {
    [...document.querySelectorAll('.modal .btn')].find(x => x.textContent === '取消')?.click();
    await new Promise(r => setTimeout(r, 300));
  });
  await p.screenshot({ path: OUT + '/m5-settings.png' });

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally {
  await b.close();
}
