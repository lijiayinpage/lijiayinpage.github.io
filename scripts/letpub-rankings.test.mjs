import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLetpub,refreshLetpub} from './letpub-rankings.mjs';
const source='https://www.letpub.com.cn/index.php?journalid=123&page=journalapp&view=detail';
const table=(header,cell)=>`<tr><td>${header}</td><td><table><tr><th>大类学科</th><th>小类学科</th><th>Top期刊</th><th>综述期刊</th></tr><tr><td>${cell}</td><td><table><tr><td>小类 1区</td></tr></table></td></tr></table></td></tr>`;
const html='<h1>Test Journal 期刊收藏夹</h1>'+table('《新锐期刊分区表》<br>2026年3月发布','计算机科学 1区')+table('期刊分区表<br>（2023年12月旧的升级版）','计算机科学 <span style="display:none">4区</span><span>2区</span><span style="display: none">1区</span>');
test('parser reads visible historical CAS major category, excludes XR, hidden grades and minor categories',()=>{
 const rows=parseLetpub(html,'Test Journal',source,'2026-10-10');
 assert.equal(rows.length,1);assert.equal(rows[0].year,2023);assert.equal(rows[0].quartile,2);assert.equal(rows[0].category,'计算机科学');
 assert.throws(()=>parseLetpub(html,'Wrong Journal',source,'2026-10-10'),/identity/);
 assert.throws(()=>parseLetpub(html.replace('Test Journal 期刊收藏夹','Test Journal of Medicine 期刊收藏夹'),'Test Journal',source,'2026-10-10'),/identity/);
 assert.throws(()=>parseLetpub(html.replace('<span>2区</span>','<span>2区 3区</span>'),'Test Journal',source,'2026-10-10'),/unambiguous/);
});
test('new journals use exact ISSN search and require a unique matching title',async()=>{
 const papers=[{type:'journal-article',venue:'Test Journal',issns:['1234-5678']}];
 const get=async url=>url.includes('view=search')?'<a href="./index.php?journalid=123&amp;page=journalapp&amp;view=detail">Test Journal</a>':html;
 const refreshed=await refreshLetpub(papers,[],get,'2026-10-10');
 assert.equal(refreshed.rankings.length,1);assert.equal(refreshed.warnings.length,0);
 const ambiguous=await refreshLetpub(papers,[],async()=>'<a href="?journalid=123">Test Journal</a><a href="?journalid=124">Test Journal</a>');
 assert.equal(ambiguous.rankings.length,0);assert.equal(ambiguous.warnings.length,1);
});
test('LetPub refresh preserves cache on outage, updates changed grades, and does not invent missing years',async()=>{
 const papers=[{type:'journal-article',venue:'Test Journal',issns:['1234-5678']}];
 const cache=parseLetpub(html,'Test Journal',source,'2026-10-10');
 const failed=await refreshLetpub(papers,cache,async()=>{throw new Error('offline');});
 assert.deepEqual(failed.rankings,cache);assert.equal(failed.warnings.length,1);
 const changed=await refreshLetpub(papers,cache,async()=>html.replace('<span>2区</span>','<span>3区</span>'),'2026-10-11');
 assert.equal(changed.rankings[0].quartile,3);assert.equal(changed.rankings[0].checkedAt,'2026-10-11');
 assert.equal(changed.rankings.some(r=>r.year===2026),false);
});
