import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refreshLetpub, fetchPage, isLetpubSource } from './letpub-rankings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = new Set(['journal-article', 'proceedings-article', 'book-chapter']);
const CARD = /<article\b[^>]*class="publication"[^>]*>[\s\S]*?<\/article>/g;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const decode = value => String(value ?? '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,
  s => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[s]);
const clean = value => decode(value).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
export const key = value => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function doiKey(value) {
  let text=String(value ?? '').trim();
  try { text=decodeURIComponent(text); } catch { /* Some DOI suffixes contain a literal percent. */ }
  return text.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').toLowerCase();
}
const orcidKey = value => String(value ?? '').replace(/^https?:\/\/orcid\.org\//,'').replace(/\/$/,'');
export const venueKey = value => key(clean(value).replace(/\b(?:proceedings|of|the|on|and|international|conference|symposium|\d+(?:st|nd|rd|th)|v\.?\d+|20\d{2})\b/gi,' '));
const todayInChina = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date());
function dateOf(value) {
  const p=value?.['date-parts']?.[0];
  if (!Array.isArray(p) || !Number.isInteger(p[0]) || p[0]<1900 || p.length>3) return null;
  if (p[1]!=null && (!Number.isInteger(p[1]) || p[1]<1 || p[1]>12)) return null;
  if (p[2]!=null && (!Number.isInteger(p[2]) || p[2]<1 || p[2]>31)) return null;
  if (p.length===3 && new Date(Date.UTC(...[p[0],p[1]-1,p[2]])).getUTCDate()!==p[2]) return null;
  return p.map((n,i)=>i?String(n).padStart(2,'0'):String(n)).join('-');
}
export function publishedDate(work,today=todayInChina()) {
  // Formal print date determines the journal's historical ranking year. An
  // already published online-first paper with a future print date uses online.
  const dates=['published-print','published-online','published','issued'].map(k=>dateOf(work[k]));
  return dates.find(d=>d && d<=today) || null;
}
export function normalizeWork(work,config,trustedOrcid=false,today=todayInChina()) {
  if (!TYPES.has(work.type)) return null;
  const doi=doiKey(work.DOI);
  if (!/^10\.\d{4,9}\/\S+$/.test(doi) || config.excludeDois.some(d=>doiKey(d)===doi)) return null;
  const names=new Set(config.authorNames.map(key));
  const authors=(work.author||[]).map(a=>({name:clean([a.given,a.family].filter(Boolean).join(' ')||a.name),orcid:orcidKey(a.ORCID)})).filter(a=>a.name);
  const self=authors.find(a=>a.orcid===config.orcid) || (trustedOrcid && authors.find(a=>!a.orcid && names.has(key(a.name))));
  if (!self) return null;
  const title=clean(work.title?.[0]);
  const venue=clean(work['container-title']?.at(-1));
  const date=publishedDate(work,today);
  if (!title || !venue || !date) return null;
  return {doi,title,authors:authors.map(a=>({name:a.name,self:a===self})),venue,date,year:Number(date.slice(0,4)),
    type:work.type,issns:work.ISSN||[],volume:clean(work.volume),issue:clean(work.issue),
    pages:clean(work.page||work['article-number']),publisher:clean(work.publisher),url:`https://doi.org/${doi}`};
}
export async function fetchJson(url,email) {
  let failure;
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':`JiayinLi-Publications/2.0 (mailto:${email})`},signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.json();
    }catch(e){failure=e;if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));}
  }
  throw failure;
}
export async function discover(config,get=fetchJson) {
  const papers=new Map(), warnings=[];
  let sources=0;
  try {
    let cursor='*';const seen=new Set();
    while(cursor) {
      if(seen.has(cursor))throw new Error('Crossref pagination did not advance');
      seen.add(cursor);
      const params=new URLSearchParams({filter:`orcid:https://orcid.org/${config.orcid}`,rows:'100',cursor,mailto:config.contactEmail});
      const data=await get(`https://api.crossref.org/works?${params}`,config.contactEmail);
      if(!Array.isArray(data.message?.items))throw new Error('Invalid Crossref response');
      for(const item of data.message.items){const paper=normalizeWork(item,config);if(paper)papers.set(paper.doi,paper);}
      if(data.message.items.length<100)break;
      cursor=data.message['next-cursor'];
      if(!cursor)throw new Error('Missing Crossref cursor');
    }
    sources++;
  }catch(e){warnings.push(`Crossref: ${e.message}`);}
  try {
    const data=await get(`https://pub.orcid.org/v3.0/${config.orcid}/works`,config.contactEmail);
    if(!Array.isArray(data.group))throw new Error('Invalid ORCID response');
    const dois=new Set();
    for(const group of data.group) for(const summary of group['work-summary']||[]) {
      if(!['journal-article','conference-paper','book-chapter'].includes(summary.type))continue;
      for(const id of summary['external-ids']?.['external-id']||[])if(id['external-id-type']==='doi' && id['external-id-relationship']==='self'){
        const doi=doiKey(id['external-id-value']);if(/^10\.\d{4,9}\/\S+$/.test(doi))dois.add(doi);
      }
    }
    for(const doi of [...dois].sort()) {
      if(papers.has(doi) || config.excludeDois.some(d=>doiKey(d)===doi))continue;
      try {
        const data=await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(config.contactEmail)}`,config.contactEmail);
        const paper=normalizeWork(data.message||{},config,true);if(paper)papers.set(paper.doi,paper);
      }catch(e){warnings.push(`${doi}: ${e.message}`);}
    }
    sources++;
  }catch(e){warnings.push(`ORCID: ${e.message}`);}
  if(!sources)throw new Error('All discovery sources failed; existing files were preserved. '+warnings.join('; '));
  return {papers:[...papers.values()],warnings};
}

export function qualify(paper,catalogs,letpub,types) {
  const matches=[];
  const journal=paper.type==='journal-article';
  const edition=catalogs.find(c=>paper.year>=c.fromYear && paper.year<=c.throughYear);
  const excludedTrack=/\b(workshop|companion|short papers?|demo(?:nstration)?|findings|extended abstracts?|doctoral|tutorial)\b/i.test(paper.venue);
  const entry=edition?.entries.find(e=>e.type===(journal?'journal':'conference') && venueKey(e.title)===venueKey(paper.venue));
  const track=types[paper.doi];
  const regular=track?.verified===true && ['full','regular'].includes(track.type) && /^https:\/\//.test(track.source||'');
  if(entry && ['A','B'].includes(entry.rank) && (journal || (!excludedTrack && regular))) {
    matches.push({system:'CCF',grade:entry.rank,edition:edition.edition,publicationYear:paper.year,
      label:`CCF ${entry.rank} · ${edition.edition}版（发表年 ${paper.year}）`,source:`${edition.source}#page=${entry.page}`,
      ...(journal?{}:{paperTypeSource:track.source})});
  }
  if(journal) {
    for(const r of letpub) {
      const identity=r.issns?.some(s=>paper.issns.includes(s)) || key(r.journal)===key(paper.venue);
      if(identity && r.year===paper.year && r.verified===true && r.platform==='LetPub' && r.rankingSystem==='CAS' &&
        r.categoryType==='major' && [1,2].includes(r.quartile) && isLetpubSource(r.source)) {
        matches.push({system:'LetPub-CAS',grade:r.quartile,edition:r.edition,publicationYear:paper.year,
          label:`LetPub 中科院大类 ${r.quartile}区 · ${r.edition}`,source:r.source,category:r.category});
      }
    }
  }
  if(matches.length)return {eligible:true,status:'eligible',evidence:matches};
  const reason=entry && ['A','B'].includes(entry.rank) && !journal
    ? (excludedTrack || (track?.verified && !['full','regular'].includes(track.type)) ? '会议论文属于短文、Demo、Workshop 等非正式长文' : '会议等级符合，但尚缺 Full/Regular paper 类型证据')
    : journal ? '尚无发表当年 LetPub 中科院大类 1/2 区或适用 CCF A/B 证据' : '尚无适用 CCF A/B 正式会议论文证据';
  const rejected=!journal && (excludedTrack || (track?.verified && !['full','regular'].includes(track.type)) || entry?.rank==='C');
  return {eligible:false,status:rejected?'rejected':'unverified',evidence:[],reason};
}

const selfNameKey = name => key(clean(name).replace(/\([^)]*\)|（[^）]*）/g,'').replace(/[*†‡]/g,''));
function isSelfName(name,config) {
  return config.authorNames.some(n=>selfNameKey(n)===selfNameKey(name));
}
export function authorRole(paper,roles=[]) {
  const selfIndex=paper.authors.findIndex(a=>a.self);
  const proof=roles.find(r=>r.verified===true && typeof r.source==='string' && r.source.length>0 &&
    (r.doi && paper.doi?doiKey(r.doi)===doiKey(paper.doi):Boolean(r.title) && key(r.title)===key(paper.title)));
  return {first:selfIndex===0 || proof?.firstAuthor===true,corresponding:proof?.corresponding===true};
}
function roleTitle(role) {
  return [role.first?'第一作者':'',role.corresponding?'通讯作者':''].filter(Boolean).join('、');
}
function selfMarkup(label,role) {
  const title=roleTitle(role);
  return title?`<b class="author-lead" title="${title}">${label}</b>`:`<b>${label}</b>`;
}
export function collectManualAuthorRoles(html,config) {
  return [...html.matchAll(CARD)].filter(m=>!m[0].includes('data-auto-publication=')).flatMap(m=>{
    const card=m[0],authors=card.match(/<p class="authors">([\s\S]*?)<\/p>/)?.[1]||'';
    const self=[...authors.matchAll(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/g)].find(a=>isSelfName(a[1],config));
    if(!self || !/[*†‡]/.test(clean(self[1])) || !/Corresponding Author|通讯作者/i.test(card))return [];
    return [{title:clean(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1]),corresponding:true,verified:true,
      source:'user-provided-homepage',evidence:'原主页本人姓名带通讯标记，且该论文明确标注 Corresponding Author'}];
  });
}
export function highlightManualAuthor(card,config,roles=[]) {
  const title=clean(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1]);
  return card.replace(/(<p class="authors">)([\s\S]*?)(<\/p>)/,(_,open,authors,close)=>{
    const names=clean(authors).split(/[,，]/);
    const paper={title,doi:card.match(/\b10\.\d{4,9}\/[^\s<"&]+/)?.[0],authors:names.map(name=>({name,self:isSelfName(name,config)}))};
    const role=authorRole(paper,roles);
    return open+authors.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/g,(original,tag,label)=>isSelfName(label,config)?selfMarkup(label,role):original)+close;
  });
}
export function renderPaper(paper,config,roles=[]) {
  const grade=paper.qualification.evidence.map(e=>`<a href="${escape(e.source)}" target="_blank" rel="noopener noreferrer">${escape(e.label)}</a>`).join('；');
  const role=authorRole(paper,roles);
  const authors=paper.authors.map(a=>a.self?selfMarkup(escape(config.displayName),role):escape(a.name)).join(', ');
  const citation=[paper.volume?`${escape(paper.volume)}${paper.issue?`(${escape(paper.issue)})`:''}`:'',paper.pages?`pp. ${escape(paper.pages)}`:'',escape(paper.date)].filter(Boolean).join(', ');
  return `        <article class="publication" data-auto-publication="${escape(paper.doi)}" data-publication-year="${paper.year}">
          <div class="publication-visual">
            <svg viewBox="0 0 240 154" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="学术论文示意图（非论文原图）">
              <rect x="44" y="16" width="102" height="118" rx="10" fill="#e1eef6"/>
              <rect x="58" y="30" width="74" height="88" rx="6" fill="#fdfefe"/>
              <path d="M70 45h48M70 55h36M70 65h42" stroke="#9bb8cb" stroke-width="3" stroke-linecap="round"/>
              <rect x="70" y="94" width="9" height="13" rx="2" fill="#62aaa0"/>
              <rect x="85" y="84" width="9" height="23" rx="2" fill="#649bbd"/>
              <rect x="100" y="76" width="9" height="31" rx="2" fill="#d4ae61"/>
              <circle cx="172" cy="81" r="29" fill="#e4f2ee"/>
              <path d="m159 81 9 9 18-19" stroke="#62aaa0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>${paper.type==='journal-article'?'JOURNAL':'CONFERENCE'} <span class="figure-dot">·</span> ${paper.year}</span>
          </div>
          <div class="publication-body">
            <h3>${escape(paper.title)}</h3>
            <p class="authors">${authors}</p>
            <p class="citation"><i>${escape(paper.venue)}</i>, ${citation}.<br />DOI: ${escape(paper.doi)}<b>${grade}</b></p>
            <div class="paper-links" aria-label="论文官方链接"><a class="pill paper-download" href="${escape(paper.url)}" target="_blank" rel="noopener noreferrer" title="打开出版方官方页面，按站点权限获取全文">官方下载 <span aria-hidden="true">↗</span></a><span class="publisher-name">${escape(paper.publisher)}</span></div>
            <div class="tags"><span>${paper.type==='journal-article'?'Journal Article':'Conference Paper'}</span></div>
          </div>
        </article>`;
}
export function updateHtml(html,papers,config,roles=[]) {
  const start=html.indexOf('<h2 id="papers-heading">'), headingEnd=html.indexOf('</h2>',start)+5, end=html.indexOf('</section>',headingEnd);
  if(start<0 || headingEnd<5 || end<0)throw new Error('Publications section was not found.');
  const cards=[...html.slice(headingEnd,end).matchAll(CARD)].map(m=>m[0]);
  if(!cards.length)throw new Error('Existing publication cards were not found.');
  const evidence=[...roles,...collectManualAuthorRoles(html,config)];
  const manual=cards.filter(c=>!c.includes('data-auto-publication=')).map(c=>highlightManualAuthor(c,config,evidence));
  const titles=new Set(manual.map(c=>key(c.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1])));
  const doiText=manual.join('\n').toLowerCase();
  const rows=manual.map((html,index)=>({html:'        '+html,index,year:Number(clean(html.match(/<p class="citation">([\s\S]*?)<\/p>/)?.[1]).match(/\b(?:19|20)\d{2}\b/)?.[0]||0)}));
  for(const paper of [...papers].sort((a,b)=>b.date.localeCompare(a.date)||a.doi.localeCompare(b.doi))) {
    if(!paper.qualification.eligible || titles.has(key(paper.title)) || doiText.includes(paper.doi))continue;
    titles.add(key(paper.title));rows.push({html:renderPaper(paper,config,evidence),index:rows.length,year:paper.year});
  }
  rows.sort((a,b)=>b.year-a.year||a.index-b.index);
  return html.slice(0,headingEnd)+'\n'+rows.map(r=>r.html).join('\n')+'\n      '+html.slice(end);
}

export async function sync({root=ROOT,get=fetchJson,getPage=fetchPage,dryRun=false}={}) {
  const json=async file=>JSON.parse(await readFile(resolve(root,file),'utf8'));
  const config=await json('publications.config.json');
  const catalogs=await json('data/ccf-catalogs.json'),cachedRankings=await json('data/letpub-rankings.json'),types=await json('data/paper-types.json');
  const roles=await json('data/author-roles.json');
  const htmlPath=resolve(root,'index.html'),oldHtml=await readFile(htmlPath,'utf8');
  let oldData='[]\n';try{oldData=await readFile(resolve(root,'data/publications.json'),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  const cached=JSON.parse(oldData);
  const {papers,warnings}=await discover(config,get);
  const all=new Map(cached.map(p=>[p.doi,p]));for(const p of papers)all.set(p.doi,p);
  const refreshed=await refreshLetpub([...all.values()],cachedRankings,getPage);
  warnings.push(...refreshed.warnings);
  const results=[...all.values()].filter(p=>!config.excludeDois.some(d=>doiKey(d)===p.doi)).sort((a,b)=>b.date.localeCompare(a.date)||a.doi.localeCompare(b.doi))
    .map(p=>({...p,qualification:qualify(p,catalogs,refreshed.rankings,types)}));
  const newHtml=updateHtml(oldHtml,results,config,roles);
  const writes=new Map([[htmlPath,newHtml],[resolve(root,'data/publications.json'),JSON.stringify(results,null,2)+'\n']]);
  writes.set(resolve(root,'data/letpub-rankings.json'),JSON.stringify(refreshed.rankings,null,2)+'\n');
  const manualTitles=new Set([...oldHtml.matchAll(CARD)].filter(m=>!m[0].includes('data-auto-publication=')).map(m=>key(m[0].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1])));
  const pending=results.filter(p=>p.qualification.status==='unverified' && !manualTitles.has(key(p.title)));
  writes.set(resolve(root,'data/pending-publications.json'),JSON.stringify(pending,null,2)+'\n');
  let changed=false;
  for(const [file,contents] of writes) {
    let old='';try{old=await readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(old!==contents){changed=true;if(!dryRun){await mkdir(dirname(file),{recursive:true});await writeFile(file,contents);}}
  }
  return {changed,found:papers.length,eligible:results.filter(p=>p.qualification.eligible).length,
    added:[...newHtml.matchAll(CARD)].length-[...oldHtml.matchAll(CARD)].length,total:[...newHtml.matchAll(CARD)].length,pending:pending.length,warnings};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const result=await sync({dryRun:process.argv.includes('--dry-run')});console.log(JSON.stringify(result,null,2));
    if(process.env.GITHUB_ACTIONS)for(const w of result.warnings)console.log('::warning::'+w.replace(/[\r\n]/g,' '));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
