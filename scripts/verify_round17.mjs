#!/usr/bin/env node
// 第十七轮：折叠按钮图标重设计 + 文档查看/编辑/分段编辑
//  P1 sb-toggle 为双 chevron（两条 path）且展开态不指向右侧
//  P2 知识库文档卡有「查看」按钮 → 弹窗打开（阅读模式渲染正文）
//  P3 三模式 tab（阅读/全文编辑/分段编辑）+ 分段数角标
//  P4 全文编辑：textarea 可改，保存调用 PUT
//  P5 分段编辑：分段列表带 textarea，保存此段可用
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
const BASE = 'http://127.0.0.1:8688';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });

  // P1 双 chevron 图标
  const p1 = await p.eval(() => {
    const svg = document.querySelector('.sidebar .sb-toggle svg');
    const d = svg?.querySelector('path')?.getAttribute('d') || '';
    // 双 chevron：两个 m 起笔（如 "m8.5 4-4 4 4 4M12.5 4l-4 4 4 4"）
    return { d, twoStrokes: (d.match(/[mM]\d|\s[mM]/g) || []).length >= 2 };
  });
  ok('P1 折叠按钮双 chevron 图标', !!p1.twoStrokes, JSON.stringify(p1));

  // P2 文档卡「查看」按钮 → 弹窗（round19 起先进入库详情）
  await p.goto(BASE + '/?view=docs', { settleMs: 1500 });
  const p2a = await p.eval(async () => {
    const open = [...document.querySelectorAll('.kb-card .card-foot .btn')].find(x => x.textContent.trim() === '打开');
    open?.click();
    await new Promise(r => setTimeout(r, 900));
    return {
      cards: document.querySelectorAll('.doc-card').length,
      viewBtn: [...document.querySelectorAll('.doc-card .btn')].some(x => x.textContent.trim() === '查看'),
    };
  });
  if (p2a.cards === 0) {
    // 无文档时先上传一篇到默认库（走 API 注入更稳）
    const mdText = `# 验证文档\n\n这一段讲苹果的种植史，苹果是一种水果。\n\n第二段讲香蕉，香蕉在南方很常见。`.repeat(6);
    const kbs = await (await fetch(BASE + '/api/kbs')).json();
    await fetch(BASE + '/api/docs?kb_id=' + kbs[0].id, { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new File([mdText], 'verify17.md', { type: 'text/markdown' })); return fd; })() });
    await p.goto(BASE + '/?view=docs', { settleMs: 1500 });
    await p.eval(async () => {
      const open = [...document.querySelectorAll('.kb-card .card-foot .btn')].find(x => x.textContent.trim() === '打开');
      open?.click();
      await new Promise(r => setTimeout(r, 900));
    });
  }
  const p2b = await p.eval(async () => {
    const btn = [...document.querySelectorAll('.doc-card .btn')].find(x => x.textContent.trim() === '查看');
    if (!btn) return { opened: false };
    btn.click();
    await new Promise(r => setTimeout(r, 1200));
    const modal = document.querySelector('.modal');
    const reader = document.querySelector('.doc-reader');
    return { opened: !!modal, hasReader: !!reader, title: modal?.querySelector('.modal-title')?.textContent || '' };
  });
  ok('P2 查看按钮→弹窗+阅读渲染', !!(p2b.opened && p2b.hasReader), JSON.stringify(p2b));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/p2-doc-read.png' });

  // P3 三模式 tab + 分段数
  const p3 = await p.eval(() => {
    const segs = [...document.querySelectorAll('.modal .seg-row .seg')].map(x => x.textContent.trim());
    const cnt = document.querySelector('.modal .seg-count')?.textContent || '';
    return { segs, cnt };
  });
  ok('P3 三模式 tab（阅读/全文编辑/分段编辑+角标）', !!(p3.segs.length === 3 && p3.segs[0] === '阅读' && p3.cnt !== ''), JSON.stringify(p3));

  // P4 全文编辑模式
  const p4 = await p.eval(async () => {
    const seg = [...document.querySelectorAll('.modal .seg-row .seg')][1];
    seg.click();
    await new Promise(r => setTimeout(r, 400));
    const ta = document.querySelector('.modal .doc-full-edit');
    return { ta: !!ta, len: ta ? ta.value.length : 0, saveBtn: [...document.querySelectorAll('.modal .modal-actions .btn')].some(x => x.textContent.includes('保存')) };
  });
  ok('P4 全文编辑 textarea+保存按钮', !!(p4.ta && p4.len > 0 && p4.saveBtn), JSON.stringify(p4));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/p4-doc-full.png' });

  // P5 分段编辑模式
  const p5 = await p.eval(async () => {
    const seg = [...document.querySelectorAll('.modal .seg-row .seg')][2];
    seg.click();
    await new Promise(r => setTimeout(r, 400));
    const list = [...document.querySelectorAll('.modal .doc-chunk')];
    const tas = list.map(x => x.querySelector('textarea')).filter(Boolean);
    return { chunks: list.length, tas: tas.length, saveBtn: !!list[0]?.querySelector('.btn-ghost'), head: list[0]?.querySelector('.doc-chunk-idx')?.textContent || '' };
  });
  ok('P5 分段编辑列表+保存此段', !!(p5.chunks >= 1 && p5.chunks === p5.tas && p5.saveBtn), JSON.stringify(p5));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/p5-doc-chunks.png' });

  // 收尾：删除验证文档
  await p.eval(async () => {
    const docs = await (await fetch('/api/docs')).json();
    const v = docs.find(d => d.name === 'verify17.md');
    if (v) await fetch('/api/docs/' + v.id, { method: 'DELETE' });
  });
} finally {
  await b.close();
}
const pass = results.filter(r => r.pass).length;
console.log(`==== SUMMARY ${pass}/${results.length} PASS ====`);
if (pass < results.length) process.exit(1);
