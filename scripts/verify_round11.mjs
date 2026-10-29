#!/usr/bin/env node
// 第十一轮专项验证：
//  G1 会话按 assistant 分组（.sgroup / .sgroup-head / 计数）
//  G2 侧栏折叠（.brand-logo 点击 → collapsed 60px、组头隐藏、nav 仅图标）
//  G3 折叠状态 localStorage 持久化（reload 后仍折叠）+ 展开
//  G4 composer 上传按钮 + 隐藏 file input
//  G5 消息操作：user 可编辑、assistant 不可编辑；两者均有 复制文本/复制Markdown
//  G6 移动端 chat-head：设置按钮缩为纯图标（.btn-label 隐藏）、标题截断
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';

const BASE = 'http://127.0.0.1:8688';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  const errors = [];
  p.browser.on(p.sessionId, 'Runtime.exceptionThrown', (ev) => {
    errors.push((ev.exceptionDetails?.exception?.description || '').slice(0, 200));
  });
  await p.goto(BASE + '/', { settleMs: 1500 });

  // G1: 分组结构
  const g1 = await p.eval(() => ({
    groups: document.querySelectorAll('.sidebar .sgroup').length,
    heads: document.querySelectorAll('.sidebar .sgroup-head').length,
    countEls: document.querySelectorAll('.sidebar .sgroup-count').length,
    items: document.querySelectorAll('.sidebar .session-item').length,
    names: [...document.querySelectorAll('.sidebar .sgroup-name')].map(x => x.textContent.trim()).slice(0, 5),
  }));
  ok('G1 会话按 assistant 分组渲染', !!(g1.groups >= 1 && g1.heads >= 1 && g1.countEls >= 1 && g1.items >= 1), JSON.stringify(g1.names));

  // G2: 折叠（第十三+轮语义：logo+折叠按钮+图标导航；新建/会话隐藏）
  const g2 = await p.eval(async () => {
    document.querySelector('.sidebar .sb-toggle')?.click();
    await new Promise(r => setTimeout(r, 600));
    const sb = document.querySelector('.sidebar');
    return {
      collapsed: sb?.classList.contains('collapsed'),
      width: sb ? getComputedStyle(sb).width : null,
      toggleBtn: !!document.querySelector('.sidebar .sb-toggle'),
      navIcons: document.querySelectorAll('.sidebar .nav-item svg').length,
      navText: [...document.querySelectorAll('.sidebar .nav-item span')].length,
      newChatGone: !document.querySelector('.sidebar .new-chat'),
      sessionsGone: document.querySelectorAll('.sidebar .session-item').length === 0,
    };
  });
  ok('G2 sb-toggle 折叠（图标导航保留+无会话）', !!(g2.collapsed && parseFloat(g2.width) <= 62 && g2.toggleBtn && g2.navIcons === 6 && g2.navText === 0 && g2.newChatGone && g2.sessionsGone), JSON.stringify(g2));

  // G3: 持久化 + 展开（sb-toggle 再点展开，会话/文字回来）
  await p.goto(BASE + '/', { settleMs: 1500 });
  const g3 = await p.eval(async () => {
    const sb = document.querySelector('.sidebar');
    const still = sb?.classList.contains('collapsed') && localStorage.getItem('mb_sidebar_collapsed') === '1';
    document.querySelector('.sidebar .sb-toggle')?.click();
    await new Promise(r => setTimeout(r, 600));
    const sb2 = document.querySelector('.sidebar');
    return {
      still,
      expanded: sb2 && !sb2.classList.contains('collapsed'),
      headsBack: document.querySelectorAll('.sidebar .sgroup-head').length >= 1,
      navTextBack: [...document.querySelectorAll('.sidebar .nav-item span')].length >= 6,
      newChatBack: !!document.querySelector('.sidebar .new-chat'),
    };
  });
  ok('G3 折叠持久化+展开还原', !!(g3.still && g3.expanded && g3.headsBack && g3.navTextBack && g3.newChatBack), JSON.stringify(g3));

  // G4: 上传按钮 + file input
  await p.eval(() => document.querySelector('.new-chat')?.click());
  await sleep(1000);
  const g4 = await p.eval(() => ({
    upBtn: !!document.querySelector('.composer .cap-picker[aria-label="上传文件"]'),
    fileInput: !!document.querySelector('.composer input[type="file"]'),
    accept: document.querySelector('.composer input[type="file"]')?.accept || '',
  }));
  ok('G4 composer 上传按钮+file input', !!(g4.upBtn && g4.fileInput && g4.accept.includes('image')), JSON.stringify(g4));

  // 发一条消息供 G5 用
  await p.eval(async () => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '回答就好，不用工具：1+1 等于几？');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    document.querySelector('.btn-send').click();
  });
  for (let i = 0; i < 60; i++) { await sleep(1000); const has = await p.eval(() => !!document.querySelector('#typing-msg')); if (!has) break; }
  await sleep(800);

  // G5: user 可编辑 / assistant 不可编辑；均有复制按钮
  const g5 = await p.eval(() => {
    const u = document.querySelector('.msg-user');
    const a = [...document.querySelectorAll('.msg-assistant')].pop();
    return {
      userEdit: !!u?.querySelector('.msg-edit-btn'),
      userCopy: (u?.querySelectorAll('.msg-copy-btn') || []).length,
      asstEdit: !!a?.querySelector('.msg-edit-btn'),
      asstCopy: (a?.querySelectorAll('.msg-copy-btn') || []).length,
    };
  });
  ok('G5 user 可编辑/assistant 不可编辑+双复制按钮',
    !!(g5.userEdit && g5.userCopy >= 2 && !g5.asstEdit && g5.asstCopy >= 2), JSON.stringify(g5));

  // G6: 移动端 chat-head
  const pm = await b.newPage({ width: 390, height: 844 });
  await pm.goto(BASE + '/', { settleMs: 1500 });
  const g6 = await pm.eval(() => {
    const btn = document.querySelector('.chat-head .btn-secondary');
    const label = btn?.querySelector('.btn-label');
    const h1 = document.querySelector('.chat-head h1');
    return {
      hasBtn: !!btn,
      btnSquare: btn ? Math.abs(btn.getBoundingClientRect().width - btn.getBoundingClientRect().height) < 6 && btn.getBoundingClientRect().width <= 40 : false,
      labelHidden: label ? getComputedStyle(label).display === 'none' : null,
      h1Trunc: h1 ? (getComputedStyle(h1).textOverflow === 'ellipsis') : false,
      noHScroll: document.documentElement.scrollWidth <= 391,
    };
  });
  ok('G6 移动端 header 紧凑（图标化+截断）',
    !!(g6.hasBtn && g6.btnSquare && g6.labelHidden && g6.h1Trunc && g6.noHScroll), JSON.stringify(g6));
  await pm.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/g6-mobile-head.png' });

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (errors.length) console.log('page-exceptions:', JSON.stringify(errors.slice(0, 5)));
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally {
  await b.close();
}
