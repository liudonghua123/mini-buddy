#!/usr/bin/env node
// 第十五轮：知识视图（记忆/文档/定时任务）+ 导航
//  K1 底部导航含「知识」项 + 深链进入
//  K2 记忆 tab：列表 + 新增弹窗 + 保存后出现
//  K3 文档 tab：上传按钮 + 检索测试框 + 文档卡片
//  K4 定时任务 tab：新建弹窗（频率/会话/提示词）+ 任务卡
//  K5 折叠态导航含知识图标
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

  // K1
  await p.goto(BASE + '/', { settleMs: 1500 });
  const k1 = await p.eval(() => ({
    navLabels: [...document.querySelectorAll('.sidebar .nav-item')].map(x => x.textContent.trim().replace(/\d+$/, '')),
    dot: [...document.querySelectorAll('.sidebar .nav-item .count')].length,
  }));
  ok('K1 侧栏含知识导航', !!(k1.navLabels.some(x => x.includes('知识'))), JSON.stringify(k1.navLabels));

  // K2 记忆
  await p.goto(BASE + '/?view=knowledge', { settleMs: 1500 });
  const k2 = await p.eval(async () => {
    const before = document.querySelectorAll('.mem-item').length;
    [...document.querySelectorAll('button')].find(x => x.textContent.includes('新增记忆'))?.click();
    await new Promise(r => setTimeout(r, 400));
    const modal = document.querySelector('.modal');
    if (!modal) return { modal: false };
    const ta = modal.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '自动化验证记忆 ' + Date.now() % 10000);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    [...modal.querySelectorAll('button')].find(x => x.textContent === '保存')?.click();
    await new Promise(r => setTimeout(r, 800));
    return { modal: true, after: document.querySelectorAll('.mem-item').length, before };
  });
  ok('K2 记忆新增（弹窗+保存+列表刷新）', !!(k2.modal && k2.after > k2.before), JSON.stringify(k2));

  // K3 文档
  const k3 = await p.eval(async () => {
    [...document.querySelectorAll('.tab-seg .seg')].find(x => x.textContent === '文档')?.click();
    await new Promise(r => setTimeout(r, 600));
    return {
      fileInput: !!document.querySelector('input[type="file"][accept*="pdf"]'),
      searchBox: !!document.querySelector('.rag-test input'),
      cards: document.querySelectorAll('.doc-card').length,
    };
  });
  ok('K3 文档 tab（上传+检索框+卡片）', !!(k3.fileInput && k3.searchBox && k3.cards >= 1), JSON.stringify(k3));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/k3-docs.png' });

  // K3b 检索测试
  const k3b = await p.eval(async () => {
    const inp = document.querySelector('.rag-test input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, 'Mini Buddy 支持知识库功能');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    [...document.querySelectorAll('button')].find(x => x.textContent === '检索')?.click();
    await new Promise(r => setTimeout(r, 800));
    return { hits: document.querySelectorAll('.rag-hit').length };
  });
  ok('K3b 检索测试命中', !!(k3b.hits >= 1), JSON.stringify(k3b));

  // K4 定时任务
  const k4 = await p.eval(async () => {
    [...document.querySelectorAll('.tab-seg .seg')].find(x => x.textContent === '定时任务')?.click();
    await new Promise(r => setTimeout(r, 600));
    const before = document.querySelectorAll('.task-item').length;
    [...document.querySelectorAll('button')].find(x => x.textContent.includes('新建任务'))?.click();
    await new Promise(r => setTimeout(r, 400));
    const modal = document.querySelector('.modal');
    if (!modal) return { modal: false };
    const setVal = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(modal.querySelector('input[placeholder*="例如"]'), '浏览器验证任务');
    setVal(modal.querySelector('textarea'), '说一句自动化验证的话');
    await new Promise(r => setTimeout(r, 100));
    [...modal.querySelectorAll('button')].find(x => x.textContent === '保存')?.click();
    await new Promise(r => setTimeout(r, 800));
    return { modal: true, before, after: document.querySelectorAll('.task-item').length };
  });
  ok('K4 定时任务新建（弹窗+保存+列表刷新）', !!(k4.modal && k4.after > k4.before), JSON.stringify(k4));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/k4-tasks.png' });

  // K5 折叠态知识图标
  const k5 = await p.eval(async () => {
    document.querySelector('.sidebar .sb-toggle')?.click();
    await new Promise(r => setTimeout(r, 600));
    const icons = document.querySelectorAll('.sidebar .nav-item svg').length;
    document.querySelector('.sidebar .sb-toggle')?.click();
    await new Promise(r => setTimeout(r, 400));
    return { collapsedNavIcons: icons };
  });
  ok('K5 折叠态导航含 5 个图标（含知识）', !!(k5.collapsedNavIcons === 5), JSON.stringify(k5));

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally { await b.close(); }
