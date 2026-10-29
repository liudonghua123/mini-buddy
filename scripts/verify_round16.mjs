#!/usr/bin/env node
// 第十六轮：定时任务独立视图 / 知识库独立视图 / 记忆移入设置
//  N1 侧栏 7 项导航（含 知识库 / 定时任务），折叠态 6 图标
//  N2 知识库视图：上传按钮 + 检索测试 + 文档卡
//  N3 定时任务视图：新建弹窗 + 任务卡
//  N4 设置页含记忆区块（新增记忆弹窗可用）
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

  // N1
  const n1 = await p.eval(() => ({
    labels: [...document.querySelectorAll('.sidebar .nav-item')].map(x => x.textContent.trim().replace(/\d+$/, '')),
  }));
  ok('N1 侧栏导航含 知识库+定时任务', !!(n1.labels.some(x => x.includes('知识库')) && n1.labels.some(x => x.includes('定时任务'))), JSON.stringify(n1.labels));

  // N2 知识库（round19 起为两级结构：先库列表，进入库详情看文档）
  await p.goto(BASE + '/?view=docs', { settleMs: 1500 });
  const n2 = await p.eval(async () => {
    const h1 = document.querySelector('.view-head h1')?.textContent;
    const kbCards = document.querySelectorAll('.kb-card').length;
    // 进入第一个库
    const open = [...document.querySelectorAll('.kb-card .card-foot .btn')].find(x => x.textContent.trim() === '打开');
    open?.click();
    await new Promise(r => setTimeout(r, 800));
    return {
      h1,
      kbCards,
      back: !!document.querySelector('.crumb-back'),
      fileInput: !!document.querySelector('input[type="file"][accept*="pdf"]'),
      searchBox: !!document.querySelector('.rag-test input'),
      cards: document.querySelectorAll('.doc-card').length,
    };
  });
  ok('N2 知识库视图元素齐全', !!(n2.h1 === '知识库' && n2.kbCards >= 1 && n2.back && n2.fileInput && n2.searchBox), JSON.stringify(n2));

  // N3 定时任务
  await p.goto(BASE + '/?view=tasks', { settleMs: 1500 });
  const n3 = await p.eval(async () => {
    const h1 = document.querySelector('.view-head h1')?.textContent;
    const before = document.querySelectorAll('.task-item').length;
    [...document.querySelectorAll('button')].find(x => x.textContent.includes('新建任务'))?.click();
    await new Promise(r => setTimeout(r, 400));
    const modal = document.querySelector('.modal');
    return { h1, before, modal: !!modal, hasSeg: !!modal?.querySelector('.seg-row'), hasSelect: !!modal?.querySelector('select') };
  });
  ok('N3 定时任务独立视图+新建弹窗', !!(n3.h1 === '定时任务' && n3.modal && n3.hasSeg && n3.hasSelect), JSON.stringify(n3));
  await p.eval(async () => {
    [...document.querySelectorAll('.modal .btn-ghost')].find(x => x.textContent === '取消')?.click();
    await new Promise(r => setTimeout(r, 300));
  });
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/n3-tasks.png' });

  // N4 设置页记忆
  await p.goto(BASE + '/?view=settings', { settleMs: 1500 });
  const n4 = await p.eval(async () => {
    const hasSection = [...document.querySelectorAll('.settings-card .c-name')].some(x => x.textContent === '记忆');
    [...document.querySelectorAll('button')].find(x => x.textContent.includes('新增记忆'))?.click();
    await new Promise(r => setTimeout(r, 400));
    const modal = document.querySelector('.modal');
    return { hasSection, modal: !!modal };
  });
  ok('N4 设置页含记忆区块+弹窗', !!(n4.hasSection && n4.modal), JSON.stringify(n4));
  await p.eval(async () => {
    [...document.querySelectorAll('.modal .btn-ghost')].find(x => x.textContent === '取消')?.click();
    await new Promise(r => setTimeout(r, 200));
  });
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/n4-settings-memory.png' });

  // N5 折叠态 6 图标
  const n5 = await p.eval(async () => {
    document.querySelector('.sidebar .sb-toggle')?.click();
    await new Promise(r => setTimeout(r, 600));
    const icons = document.querySelectorAll('.sidebar .nav-item svg').length;
    document.querySelector('.sidebar .sb-toggle')?.click();
    return { icons };
  });
  ok('N5 折叠态 6 个导航图标', !!(n5.icons === 6), JSON.stringify(n5));

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally { await b.close(); }
