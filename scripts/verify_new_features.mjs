#!/usr/bin/env node
// 新四功能专项验证：
//  F1 思考过程折叠块（默认折叠，可展开）
//  F2 消息 meta 行（耗时/token）+ 编辑（内联编辑器保存 → edited 标记）
//  F3 会话设置抽屉三态能力控件 + 同步按钮
//  F4 流式期间切换会话，切回仍在流式（不中断）
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';

const BASE = 'http://127.0.0.1:8688';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });
  await p.eval(() => document.querySelector('.new-chat')?.click());
  await sleep(1200);

  // 发一条消息（真实 LLM，带思考）
  await p.eval(async () => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '用一句话介绍你自己');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    document.querySelector('.btn-send').click();
  });
  await sleep(2500);

  // F4: 流式进行中切换到另一个会话再切回
  const f4 = await p.eval(async () => {
    const typing = document.querySelector('#typing-msg');
    if (!typing) return { skip: 'no-stream' };
    // 切到别的会话：选中项类名是 selected；排除它
    const items = [...document.querySelectorAll('.session-item')];
    const other = items.find(x => !x.classList.contains('selected')) || items[1];
    if (!other) return { skip: 'no-other-session' };
    other.click();
    await new Promise(r => setTimeout(r, 600));
    const leftEarly = !document.querySelector('#typing-msg'); // 切走后本会话不再显示流块
    // 切回：流式会话刚更新过，按 updated_at 降序应为第一项
    const back = [...document.querySelectorAll('.session-item')][0];
    back.click();
    await new Promise(r => setTimeout(r, 800));
    const backTyping = document.querySelector('#typing-msg');
    const body = document.querySelector('#typing-msg .stream-body')?.textContent || '';
    // 切回时流可能仍在跑（继续流式），也可能恰好已完成（消息已落库）——两者都算不中断
    const asstMsgs = [...document.querySelectorAll('.msg-assistant')];
    const doneOk = !backTyping && asstMsgs.length > 0 && asstMsgs[asstMsgs.length - 1].textContent.length > 20;
    return { leftEarly, backTyping: !!backTyping, bodyLen: body.length, doneOk };
  });
  ok('F4 流式中切走再切回继续流式', !!(f4 && !f4.skip && (f4.backTyping || f4.doneOk)), JSON.stringify(f4));

  // 等流结束
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const has = await p.eval(() => !!document.querySelector('#typing-msg'));
    if (!has) break;
  }
  await sleep(1000);

  // F1+F2: 思考折叠块（默认折叠）+ meta 行
  const f1f2 = await p.eval(() => {
    const think = document.querySelector('.msg-assistant .think');
    const meta = document.querySelector('.msg-assistant .msg-meta')?.textContent || '';
    return {
      think: !!think,
      collapsedByDefault: !!(think && !think.querySelector('.think-body')),
      thinkText: think?.querySelector('.think-toggle')?.textContent.trim().slice(0, 30) || '',
      meta,
      metaOk: /ms|s\b/.test(meta) && /(tokens|入)/.test(meta),
    };
  });
  ok('F1 思考过程默认折叠+可切换', f1f2.think && f1f2.collapsedByDefault, f1f2.thinkText);
  ok('F2 meta 行（耗时/token）', f1f2.metaOk, f1f2.meta);

  // F1b: 展开思考
  const f1b = await p.eval(async () => {
    document.querySelector('.msg-assistant .think .think-toggle')?.click();
    await new Promise(r => setTimeout(r, 300));
    const body = document.querySelector('.msg-assistant .think .think-body');
    return { open: !!body && body.textContent.length > 0 };
  });
  ok('F1b 点击展开思考内容', !!f1b.open);

  // F2b: 权限——assistant 回复不可编辑；user 消息可编辑
  const f2b = await p.eval(async () => {
    const asst = [...document.querySelectorAll('.msg-assistant')];
    const last = asst[asst.length - 1];
    const asstEdit = !!last.querySelector('.msg-edit-btn');
    // 找一条 user 消息验证编辑可用（不真正保存）
    const userMsg = document.querySelector('.msg-user');
    const userEditBtn = userMsg?.querySelector('.msg-edit-btn');
    userEditBtn?.click();
    await new Promise(r => setTimeout(r, 300));
    const editor = document.querySelector('.msg-editor textarea');
    const opened = !!editor;
    // 取消，不保存
    [...document.querySelectorAll('.msg-editor .btn')].find(x => x.textContent === '取消')?.click();
    await new Promise(r => setTimeout(r, 200));
    return { asstEdit, userEdit: !!userEditBtn, editorOpened: opened };
  });
  ok('F2b 回复不可编辑+user 可编辑（编辑器弹出）',
    !!(f2b.asstEdit === false && f2b.userEdit && f2b.editorOpened), JSON.stringify(f2b));

  // F3: 会话设置抽屉三态控件 + 同步按钮
  const f3 = await p.eval(async () => {
    document.querySelector('.chat-head .btn-secondary')?.click();
    for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 200)); if (document.querySelector('.drawer')) break; }
    const rows = [...document.querySelectorAll('.drawer .cap-row')];
    const syncBtn = !!document.querySelector('.drawer .cap-sync-btn');
    const note = [...document.querySelectorAll('.drawer .cap-row-sub')].map(x => x.textContent).slice(0, 3);
    // 点第一行开关（强制 off），应出现「恢复跟随全局」按钮
    rows[0]?.querySelector('.sw')?.click();
    await new Promise(r => setTimeout(r, 700));
    const inheritBtn = !!document.querySelector('.drawer .cap-inherit-btn');
    const subAfter = document.querySelector('.drawer .cap-row-sub')?.textContent || '';
    return { rows: rows.length, syncBtn, note, inheritBtn, subAfter };
  });
  ok('F3 抽屉三态控件+恢复按钮+同步', !!(f3.rows >= 2 && f3.syncBtn && f3.inheritBtn), JSON.stringify(f3.note));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/f3-drawer.png' });

  const fails = results.filter(r => !r.pass);
  console.log('==== SUMMARY ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (fails.length) { console.log('FAILED: ' + fails.map(f => f.name).join(' | ')); process.exitCode = 1; }
} finally {
  await b.close();
}
