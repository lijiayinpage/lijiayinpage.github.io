import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {normalizeWork,publishedDate,qualify,updateHtml,sync,discover,venueKey} from './sync-publications.mjs';

const config={orcid:'0000-0003-4798-082X',authorNames:['Jiayin Li'],displayName:'Jiayin Li (李家印)',contactEmail:'test@example.com',excludeDois:[]};
const work={DOI:'10.1234/test',type:'journal-article',title:['Example paper'],author:[{given:'Jiayin',family:'Li',ORCID:`https://orcid.org/${config.orcid}`}],
 'container-title':['Test Journal'],ISSN:['1234-5678'],'published-print':{'date-parts':[[2024,6]]},'published-online':{'date-parts':[[2023,11]]}};
const paper=normalizeWork(work,config);
const catalogs=[{edition:2022,fromYear:2023,throughYear:2025,source:'https://www.ccf.org.cn/verified.pdf',entries:[{type:'journal',title:'Test Journal',rank:'A',page:1},{type:'conference',title:'ACM International Conference on Information and Knowledge Management',rank:'B',page:2}]}];
const letpub={year:2024,journal:'Test Journal',issns:['1234-5678'],platform:'LetPub',rankingSystem:'CAS',edition:'2024年升级版',categoryType:'major',quartile:2,category:'Computer Science',verified:true,source:'https://www.letpub.com.cn/index.php?journalid=123&page=journalapp&view=detail'};
const html='<html><section id="papers"><h2 id="papers-heading">Selected Publications</h2>\n<article class="publication"><h3>Original &amp; Paper</h3><p class="citation">Journal, 2023.</p><div>Original SVG</div></article>\n</section><footer>unchanged</footer></html>';

test('identity checks reject namesakes, mismatched ORCID and editor-only records',()=>{
 assert.ok(paper);
 assert.equal(normalizeWork({...work,author:[{given:'Jiayin',family:'Li'}]},config),null);
 assert.ok(normalizeWork({...work,author:[{given:'Jiayin',family:'Li'}]},config,true));
 assert.equal(normalizeWork({...work,author:[{given:'Jiayin',family:'Li',ORCID:'someone-else'}]},config,true),null);
 assert.equal(normalizeWork({...work,author:[],editor:work.author},config,true),null);
});
test('publication year comes from formal issue; online-first is a fallback and preprints are excluded',()=>{
 assert.equal(publishedDate(work,'2026-10-10'),'2024-06');
 assert.equal(publishedDate({...work,'published-print':{'date-parts':[[2099]]}},'2026-10-10'),'2023-11');
 assert.equal(publishedDate({'published-print':{'date-parts':[[2099]]}},'2026-10-10'),null);
 assert.equal(normalizeWork({...work,type:'posted-content'},config),null);
});
test('LetPub CAS 1/2 requires same year, major category and explicit evidence; XR/JCR do not qualify',()=>{
 assert.ok(qualify(paper,[],[letpub],{}).eligible);
 for(const change of [{year:2025},{rankingSystem:'XR'},{rankingSystem:'JCR'},{platform:'XR'},{quartile:3},{quartile:4},{categoryType:'minor'},{verified:false},{source:''},{source:'https://www.xr-scholar.com/journal'},{source:'https://letpub.com.cn.example.org/'}]){
   assert.equal(qualify(paper,[],[{...letpub,...change}],{}).eligible,false,JSON.stringify(change));
 }
 assert.ok(qualify(paper,catalogs,[],{}).eligible);
 assert.equal(qualify({...paper,year:2026},catalogs,[],{}).eligible,false);
});
test('CCF A/B works as OR; CCF C alone and an unknown ranking do not qualify',()=>{
 const c=[{...catalogs[0],entries:[{...catalogs[0].entries[0],rank:'C'}]}];
 assert.equal(qualify(paper,c,[],{}).eligible,false);
 assert.ok(qualify(paper,c,[letpub],{}).eligible);
 assert.equal(qualify(paper,[],[],{}).status,'unverified');
});
test('a CCF B conference needs verified full/regular paper evidence; short papers/workshops are excluded',()=>{
 const conference={...paper,type:'proceedings-article',venue:'Proceedings of the 33rd ACM International Conference on Information and Knowledge Management'};
 assert.equal(venueKey(conference.venue),venueKey(catalogs[0].entries[1].title));
 assert.equal(qualify(conference,catalogs,[],{}).eligible,false);
 const types={[paper.doi]:{type:'full',verified:true,source:'https://www.sigweb.org/toc/test.html'}};
 assert.ok(qualify(conference,catalogs,[],types).eligible);
 assert.equal(qualify(conference,catalogs,[],{[paper.doi]:{...types[paper.doi],type:'short'}}).status,'rejected');
 assert.equal(qualify({...conference,venue:conference.venue+' Workshop'},catalogs,[],types).eligible,false);
});
test('original cards are preserved, duplicates and ineligible candidates are excluded, HTML is escaped',()=>{
 const eligible={...paper,qualification:qualify(paper,catalogs,[],{})};
 const denied={...eligible,doi:'10.1234/denied',title:'Denied',qualification:{eligible:false}};
 const duplicate={...eligible,doi:'10.1234/duplicate',title:'original & paper.'};
 const newHtml=updateHtml(html,[eligible,eligible,denied,duplicate],config);
 assert.equal((newHtml.match(/data-auto-publication=/g)||[]).length,1);
 assert.ok(newHtml.includes('Original SVG'));
 assert.ok(!newHtml.includes('<h3>Denied</h3>'));
 assert.equal(updateHtml(newHtml,[eligible],config),newHtml);
 assert.ok(updateHtml(html,[{...eligible,title:'<script>alert(1)</script>'}],config).includes('&lt;script&gt;'));
});
test('catalog snapshots agree on the three relevant venue grades',async()=>{
 const snapshots=JSON.parse(await readFile(new URL('../data/ccf-catalogs.json',import.meta.url),'utf8'));
 for(const snapshot of snapshots)for(const [id,rank] of [['tdsc','A'],['kdd','A'],['cikm','B']])assert.equal(snapshot.entries.find(e=>e.id===id).rank,rank);
});
test('source outage preserves files; repeat sync is idempotent; rank revocation removes automatic cards',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ranked-publications-'));
 try{
  await mkdir(join(root,'data'));
  await writeFile(join(root,'index.html'),html);
  for(const [file,data] of [['publications.config.json',config],['data/ccf-catalogs.json',catalogs],['data/letpub-rankings.json',[]],['data/paper-types.json',{}],['data/author-roles.json',[]]])await writeFile(join(root,file),JSON.stringify(data));
  await assert.rejects(sync({root,get:async()=>{throw new Error('offline');}}),/All discovery sources failed/);
  assert.equal(await readFile(join(root,'index.html'),'utf8'),html);
  const fake=async url=>url.includes('pub.orcid.org')?{group:[]}:{message:{items:[work]}};
  const getPage=async()=>{throw new Error('unavailable');};
  assert.equal((await sync({root,get:fake,getPage,dryRun:true})).added,1);
  assert.equal(await readFile(join(root,'index.html'),'utf8'),html);
  assert.equal((await sync({root,get:fake,getPage})).added,1);
  assert.equal((await sync({root,get:fake,getPage})).changed,false);
  await writeFile(join(root,'data/ccf-catalogs.json'),'[]');
  assert.equal((await sync({root,get:fake,getPage})).total,1);
 }finally{
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\')||resolve(root).startsWith(resolve(tmpdir())+'/'));
  assert.ok(root.includes('ranked-publications-'));await rm(root,{recursive:true,force:true});
 }
});
