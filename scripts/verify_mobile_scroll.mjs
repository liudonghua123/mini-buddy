#!/usr/bin/env node
// 移动端滚动专项验证
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';

const BASE = 'http://127.0.0.1:8688';
const b = await Browser.launch({ width: 390, height: 844 });
try {
  const p = await b.newPage({ width: 390, height: 844 });
  await p.goto(BASE + '/?view=mcp', { settleMs: 1500 });
  const r = await p.eval(async () => {
    const view = document.querySelector('.view');
    const info = {
      viewScrollH: view.scrollHeight, clientH: view.clientHeight,
      canScroll: view.scrollHeight > view.clientHeight,
      overflowY: getComputedStyle(view).overflowY,
      rectH: Math.round(view.getBoundingClientRect().height),
      winH: window.innerHeight,
    };
    // 滚到底再看卡片可见性
    view.scrollTop = view.scrollHeight;
    await new Promise(r2 => setTimeout(r2, 300));
    const cards = [...document.querySelectorAll('.card-grid .card')];
    const last = cards[cards.length - 1];
    const lr = last?.getBoundingClientRect();
    info.lastCardTop = Math.round(lr?.top || 0);
    info.lastCardVisible = lr ? lr.top < window.innerHeight : false;
    info.scrolledTo = view.scrollTop;
    return info;
  });
  console.log(JSON.stringify(r, null, 1));
  const pass = r.canScroll && r.rectH <= r.winH + 2 && r.lastCardVisible;
  console.log(pass ? 'PASS: view scrolls within viewport, last card reachable' : 'FAIL');
  process.exitCode = pass ? 0 : 1;
} finally { await b.close(); }
