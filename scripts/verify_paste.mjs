#!/usr/bin/env node
// 粘贴图片端到端：DataTransfer 模拟 paste → pendingFiles chip → 发送 → 消息 files 渲染
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
const BASE = 'http://127.0.0.1:8688';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 1x1 红色 PNG
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });
  await p.eval(() => document.querySelector('.new-chat')?.click());
  await sleep(1000);
  const r1 = await p.eval(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'paste.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ta = document.querySelector('.composer textarea');
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 1500)); // 等上传
    return {
      chips: [...document.querySelectorAll('.attach-bar .pick-chip')].map(x => x.textContent.trim()),
    };
  }, B64);
  console.log((r1.chips.length === 1 && r1.chips[0] === 'paste.png' ? 'PASS' : 'FAIL') + ' | 粘贴图片出现待发卡片 | ' + JSON.stringify(r1));
  // 发送 → 等回复 → user 消息应带 .msg-files 图片
  const r2 = await p.eval(async () => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '这是什么图？');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    document.querySelector('.btn-send').click();
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 300)); if (!document.querySelector('#typing-msg')) break; }
    await new Promise(r => setTimeout(r, 800));
    const u = document.querySelector('.msg-user');
    return {
      attachGone: !document.querySelector('.attach-bar'),
      msgFiles: !!u?.querySelector('.msg-files'),
      img: u?.querySelector('.msg-files img')?.src.slice(-20) || null,
    };
  });
  console.log((r2.msgFiles && r2.img && r2.attachGone ? 'PASS' : 'FAIL') + ' | 发送后消息带图片附件 | ' + JSON.stringify(r2));
} finally { await b.close(); }
