#!/usr/bin/env node
// README 功能截图：9 张（聊天/AskCard/过程日志/MCP/技能/知识库/定时任务/助手/设置/深色）
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';

const BASE = 'http://127.0.0.1:8688';
const OUT = 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/docs/screenshots/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1800 });

  // 1. 聊天主界面：打开 HITL-E2E 会话（含完整报告）
  await p.eval(() => {
    const items = [...document.querySelectorAll('.session-item')];
    // 点第一个会话
    items[0]?.click();
  });
  await sleep(1200);
  await p.screenshot({ path: OUT + 'chat.png' });
  console.log('shot 1 chat');

  // 2. AskCard：切到带 ask 卡的会话（ses_d91626bb30 是「新会话」列表里第二个，逐个试标题）
  await p.eval(() => {
    const items = [...document.querySelectorAll('.session-item')];
    items[1]?.click();
  });
  await sleep(1200);
  await p.screenshot({ path: OUT + 'ask-card.png' });
  console.log('shot 2 ask-card');

  // 3. 过程日志展开
  await p.eval(async () => {
    const items = [...document.querySelectorAll('.session-item')];
    items[0]?.click();
    await new Promise(r => setTimeout(r, 800));
    document.querySelector('.plog-toggle')?.click();
  });
  await sleep(600);
  await p.screenshot({ path: OUT + 'process-log.png' });
  console.log('shot 3 process-log');

  // 4. MCP 页
  await p.eval(() => { [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('MCP'))?.click(); });
  await sleep(900);
  await p.screenshot({ path: OUT + 'mcp.png' });
  console.log('shot 4 mcp');

  // 5. 技能页
  await p.eval(() => { [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('技能'))?.click(); });
  await sleep(900);
  await p.screenshot({ path: OUT + 'skills.png' });
  console.log('shot 5 skills');

  // 6. 知识库（进库详情）
  await p.eval(() => { [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('知识库'))?.click(); });
  await sleep(900);
  await p.eval(() => {
    // 打开第一个库
    const open = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '打开');
    open?.click();
  });
  await sleep(900);
  await p.screenshot({ path: OUT + 'knowledge.png' });
  console.log('shot 6 knowledge');

  // 7. 定时任务
  await p.eval(() => { [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('定时任务'))?.click(); });
  await sleep(900);
  await p.screenshot({ path: OUT + 'tasks.png' });
  console.log('shot 7 tasks');

  // 8. 助手（打开第一个编辑弹窗看绑定选择器）
  await p.eval(() => { [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('助手'))?.click(); });
  await sleep(900);
  await p.screenshot({ path: OUT + 'assistants.png' });
  console.log('shot 8 assistants');

  // 9. 设置（深色主题预览：切 dark 再截，然后切回）
  await p.eval(() => { [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('设置'))?.click(); });
  await sleep(900);
  await p.screenshot({ path: OUT + 'settings.png' });
  console.log('shot 9 settings');

  // 10. 深色主题
  await p.eval(async () => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await sleep(600);
  await p.screenshot({ path: OUT + 'settings-dark.png' });
  console.log('shot 10 dark');
  await p.eval(async () => {
    localStorage.setItem('theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
  });
} finally {
  await b.close();
}
console.log('ALL DONE');
