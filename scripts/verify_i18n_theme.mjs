#!/usr/bin/env node
// i18n + 主题 验证：语言切换、深浅色切换、持久化、Monaco 联动
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
    errors.push((ev.exceptionDetails?.exception?.description || '').slice(0, 150));
  });

  // 1. 默认中文 → 设置页切 English
  await p.goto(BASE + '/?view=settings', { settleMs: 1500 });
  const t1 = await p.eval(async () => {
    const segs = [...document.querySelectorAll('.seg-item')];
    const en = segs.find(x => x.textContent === 'English');
    en?.click();
    await new Promise(r => setTimeout(r, 500));
    return {
      h1: document.querySelector('.view-head h1')?.textContent,
      themeLabel: [...document.querySelectorAll('.field label')].map(x => x.textContent).slice(0, 2),
      persisted: localStorage.getItem('mb_lang'),
    };
  });
  ok('T1 切 English 生效+持久化', !!(t1.h1 === 'Settings' && t1.persisted === 'en' && t1.themeLabel.includes('Theme')), JSON.stringify(t1));
  await p.screenshot({ path: OUT + '/t1-en.png' });

  // 2. 切深色主题：data-theme + 背景色变化
  const t2 = await p.eval(async () => {
    const dark = [...document.querySelectorAll('.seg-item')].find(x => x.textContent === 'Dark');
    dark?.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      attr: document.documentElement.dataset.theme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      persisted: localStorage.getItem('mb_theme'),
    };
  });
  ok('T2 深色主题生效+持久化', !!(t2.attr === 'dark' && t2.bodyBg !== 'rgb(247, 246, 252)' && t2.persisted === 'dark'), JSON.stringify(t2));
  await p.screenshot({ path: OUT + '/t2-dark.png' });

  // 3. 刷新后保持 深色+英文
  await p.goto(BASE + '/?view=settings', { settleMs: 1200 });
  const t3 = await p.eval(() => ({
    attr: document.documentElement.dataset.theme,
    h1: document.querySelector('.view-head h1')?.textContent,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  ok('T3 刷新后保持设置', !!(t3.attr === 'dark' && t3.h1 === 'Settings' && t3.bodyBg !== 'rgb(247, 246, 252)'), JSON.stringify(t3));

  // 4. MCP 页英文（无硬编码中文）
  await p.goto(BASE + '/?view=mcp', { settleMs: 1200 });
  const t4 = await p.eval(() => ({
    h1: document.querySelector('.view-head h1')?.textContent,
    btn: [...document.querySelectorAll('button')].some(x => x.textContent.includes('安装')) ? '中文残留' : 'ok',
    hasInstall: [...document.querySelectorAll('button')].some(x => x.textContent.includes('Install')),
  }));
  ok('T4 MCP 页英文', !!(t4.h1 === 'MCP 服务器'.replace('服务器', 'servers') || /servers/i.test(t4.h1 || '')) && t4.btn === 'ok' && t4.hasInstall, JSON.stringify(t4));
  await p.screenshot({ path: OUT + '/t4-mcp-en-dark.png' });

  // 5. 技能编辑器深色 Monaco（vs-dark）
  const t5 = await p.eval(async () => {
    [...document.querySelectorAll('.mnav-item, .nav-item')].find(x => x.textContent.includes('Skills'))?.click();
    await new Promise(r => setTimeout(r, 900));
    [...document.querySelectorAll('.card-foot .btn-ghost')].find(x => x.textContent === 'View')?.click();
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (document.querySelector('.monaco-editor')) break;
    }
    const ed = document.querySelector('.monaco-editor');
    return { loaded: !!ed, darkClass: ed?.classList.contains('vs-dark') || !!document.querySelector('.monaco-editor.vs-dark') };
  });
  ok('T5 Monaco 深色主题联动', !!(t5.loaded && t5.darkClass), JSON.stringify(t5));
  await p.screenshot({ path: OUT + '/t5-monaco-dark.png' });

  // 6. 恢复 浅色+中文
  await p.eval(async () => {
    localStorage.setItem('mb_theme', 'light');
    localStorage.setItem('mb_lang', 'zh');
  });

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally { await b.close(); }
