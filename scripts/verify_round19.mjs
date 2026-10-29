#!/usr/bin/env node
// 第十九轮：~/.mini-buddy 迁移 / KB 多库 / 搜索式绑定 / builtin 编辑
//  S1 ~/.mini-buddy 目录结构与 kbs.json 存在
//  S2 KB 列表视图（两级：库卡片 + 新建按钮）
//  S3 库详情视图（面包屑返回 + 上传 + 文档卡）
//  S4 助手弹窗搜索式选择器（bp-search + bp-chip + bp-cand）
//  S5 builtin MCP 编辑模式（描述可改、连接区块隐藏）
import { Browser } from 'file:///C:/Users/admin/.workbuddy/skills/taste-skill/scripts/lib/cdp.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const BASE = 'http://127.0.0.1:8688';
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// S1 文件系统迁移
const home = homedir();
const dataDir = join(home, '.mini-buddy', 'data');
const skillsDir = join(home, '.mini-buddy', 'skills');
const kbsFile = join(dataDir, 'kbs.json');
const s1 = {
  data: existsSync(dataDir),
  skills: existsSync(skillsDir),
  kbs: existsSync(kbsFile),
  kbCount: existsSync(kbsFile) ? JSON.parse(readFileSync(kbsFile, 'utf8')).length : 0,
  skillDirs: existsSync(skillsDir) ? readFileSync(join(dataDir, 'skills.json'), 'utf8') ? JSON.parse(readFileSync(join(dataDir, 'skills.json'), 'utf8')).length : 0 : 0,
};
ok('S1 ~/.mini-buddy 迁移', !!(s1.data && s1.skills && s1.kbs && s1.kbCount >= 1), JSON.stringify(s1));

const b = await Browser.launch({ width: 1440, height: 900 });
try {
  const p = await b.newPage({ width: 1440, height: 900 });
  await p.goto(BASE + '/', { settleMs: 1500 });

  // S2 KB 列表视图
  await p.goto(BASE + '/?view=docs', { settleMs: 1500 });
  const s2 = await p.eval(() => ({
    kbCards: document.querySelectorAll('.kb-card').length,
    newBtn: [...document.querySelectorAll('.view-head .btn')].some(x => x.textContent.includes('新建知识库')),
    firstKb: document.querySelector('.kb-card .c-name')?.textContent || '',
    hasOpen: !!document.querySelector('.kb-card .card-foot .btn'),
  }));
  ok('S2 KB 库列表视图', !!(s2.kbCards >= 1 && s2.newBtn), JSON.stringify(s2));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/s2-kb-list.png' });

  // S3 进入库详情
  const s3 = await p.eval(async () => {
    const open = [...document.querySelectorAll('.kb-card .card-foot .btn')].find(x => x.textContent.trim() === '打开');
    open?.click();
    await new Promise(r => setTimeout(r, 900));
    return {
      back: !!document.querySelector('.crumb-back'),
      upload: [...document.querySelectorAll('.view-head .btn')].some(x => x.textContent.includes('上传文档')),
      docCards: document.querySelectorAll('.doc-card').length,
      ragBox: !!document.querySelector('.rag-test'),
    };
  });
  ok('S3 库详情视图', !!(s3.back && s3.upload && s3.ragBox), JSON.stringify(s3));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/s3-kb-detail.png' });

  // S4 助手弹窗搜索式选择器（round20 起：绑定改库级 + 分区布局）
  await p.goto(BASE + '/?view=assistants', { settleMs: 1500 });
  const s4 = await p.eval(async () => {
    const btn = [...document.querySelectorAll('.ast-card .btn')].find(x => x.textContent.trim() === '编辑');
    btn?.click();
    await new Promise(r => setTimeout(r, 900));
    const pickers = document.querySelectorAll('.modal .bind-picker');
    const first = pickers[0];
    // 输入关键词测试过滤
    const input = first?.querySelector('.bp-search');
    let filterWorks = false;
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'clock');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const cands = first.querySelectorAll('.bp-cand');
      filterWorks = cands.length >= 1 && cands.length <= 3;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // 知识库选择器（第三个）候选应为库级（带 doc_count 副标题）
    const kbPicker = pickers[2];
    const kbSubs = [...(kbPicker?.querySelectorAll('.bp-cand .bp-sub') || [])].map(x => x.textContent);
    return {
      pickers: pickers.length,
      search: !!first?.querySelector('.bp-search'),
      allBtn: !!first?.querySelector('.bind-all'),
      cands: first?.querySelectorAll('.bp-cand').length || 0,
      filterWorks,
      sections: document.querySelectorAll('.modal .ast-section').length,
      kbSubs,
      kbLevelOk: (kbSubs.length > 0) && kbSubs.every(s => s.includes('文档') || s.includes('空库')),
    };
  });
  ok('S4 搜索式绑定选择器', !!(s4.pickers === 3 && s4.search && s4.allBtn && s4.filterWorks && s4.sections >= 2 && s4.kbLevelOk), JSON.stringify(s4));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/s4-bind-picker.png' });

  // S5 builtin MCP 编辑模式
  await p.goto(BASE + '/?view=mcp', { settleMs: 1500 });
  const s5 = await p.eval(async () => {
    const cards = [...document.querySelectorAll('.card')];
    const builtinCard = cards.find(c => c.querySelector('.pill') && c.textContent.includes('内置'));
    const edit = [...(builtinCard?.querySelectorAll('.btn') || [])].find(x => x.textContent.trim() === '编辑');
    edit?.click();
    await new Promise(r => setTimeout(r, 800));
    const modal = document.querySelector('.modal');
    return {
      modal: !!modal,
      hasConn: !!modal?.querySelector('.field input[placeholder*="http"], .field input[placeholder*="命令"], .field input[placeholder*="command"]'),
      descLabel: [...(modal?.querySelectorAll('label') || [])].map(l => l.textContent).join('|'),
      saveBtn: [...(modal?.querySelectorAll('.btn') || [])].some(x => x.textContent.trim() === '保存'),
    };
  });
  ok('S5 builtin MCP 编辑', !!(s5.modal && s5.saveBtn && !s5.hasConn), JSON.stringify(s5));
  await p.screenshot({ path: 'C:/Users/admin/WorkBuddy/2026-10-28-14-40-19/mini-buddy/.taste-skill/verify/s5-builtin-edit.png' });
} finally {
  await b.close();
}
const pass = results.filter(r => r.pass).length;
console.log(`==== SUMMARY ${pass}/${results.length} PASS ====`);
if (pass < results.length) process.exit(1);
