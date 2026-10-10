// Read only the public historical CAS tables. LetPub's current XR, JCR and
// CiteScore tables are separate ranking systems and must never satisfy this rule.
const text = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const identity = s => text(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function isLetpubSource(source) {
  try { const u=new URL(source);return u.protocol==='https:' && ['letpub.com.cn','www.letpub.com.cn'].includes(u.hostname); } catch { return false; }
}
export function parseLetpub(html, journal, source, checkedAt) {
  if(!isLetpubSource(source))throw new Error('Expected a LetPub source URL');
  const headings=[...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)];
  if(!headings.some(m=>identity(text(m[1]).split(/期刊收藏夹|期刊基本信息/)[0])===identity(journal)))throw new Error('LetPub journal identity mismatch');
  const rows=[];
  const headers=[...html.matchAll(/<td\b[^>]*>\s*期刊分区表\s*<br\s*\/?>([\s\S]*?)<\/td>/gi)];
  for(const [index,header] of headers.entries()) {
    const edition=text(header[1]);
    const date=edition.match(/(20\d{2})年(\d{1,2})月/);
    if(!date || !edition.includes('升级版'))continue;
    const block=html.slice(header.index+header[0].length,headers[index+1]?.index);
    // The first data cell after the four-column table header is the major
    // category. Never collect quartiles from the nested minor-category table.
    const cell=block.match(/<\/th>\s*<\/tr>\s*<tr>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];
    if(!cell)continue;
    const visible=cell.replace(/<span\b[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/span>/gi,'');
    const plain=text(visible), grades=[...plain.matchAll(/([1-4])\s*区/g)];
    if(grades.length!==1)continue; // Fail closed if the public layout changes.
    rows.push({journal,year:Number(date[1]),quartile:Number(grades[0][1]),categoryType:'major',
      category:plain.replace(/([1-4])\s*区/g,'').trim(),rankingSystem:'CAS',platform:'LetPub',
      edition:edition.replace(/[（）()]/g,'').trim(),verified:true,source,checkedAt});
  }
  if(!rows.length)throw new Error('No unambiguous historical CAS major-category tables found');
  return rows;
}
export async function fetchPage(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.text();
}
export async function refreshLetpub(papers,cached,get=fetchPage,checkedAt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date())) {
  const records=new Map(cached.map(r=>[`${identity(r.journal)}:${r.year}:${r.edition}`,r]));
  const journals=new Map(papers.filter(p=>p.type==='journal-article').map(p=>[identity(p.venue),p]));
  const warnings=[];
  for(const [name,paper] of journals) {
    try {
      let source=cached.find(r=>identity(r.journal)===name && isLetpubSource(r.source))?.source;
      if(!source) {
        const issn=paper.issns.find(s=>/^\d{4}-\d{3}[\dX]$/i.test(s));
        if(!issn)throw new Error('No ISSN available for exact journal search');
        const search=await get(`https://www.letpub.com.cn/index.php?page=journalapp&view=search&searchissn=${encodeURIComponent(issn)}`);
        const links=[...search.matchAll(/<a\b[^>]*href=["']([^"']*journalid=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
        const hits=links.filter(m=>identity(m[2])===name);
        const ids=new Set(hits.map(m=>m[1].match(/journalid=(\d+)/)?.[1]));
        if(ids.size!==1)throw new Error('No unique exact journal match in LetPub search');
        source=new URL(hits[0][1].replace(/&amp;/g,'&'),'https://www.letpub.com.cn/').href;
      }
      if(!isLetpubSource(source))throw new Error('Unexpected journal source');
      const rows=parseLetpub(await get(source),paper.venue,source,checkedAt);
      // Replace each successfully read year; retain verified old years that the
      // site no longer exposes. A failed request never erases cached evidence.
      for(const row of rows) {
        for(const [id,old] of records)if(identity(old.journal)===name && old.year===row.year)records.delete(id);
        const previous=cached.find(r=>identity(r.journal)===name && r.year===row.year && r.edition===row.edition && r.quartile===row.quartile && r.category===row.category);
        records.set(`${name}:${row.year}:${row.edition}`,{...row,checkedAt:previous?.checkedAt||checkedAt});
      }
    }catch(e){warnings.push(`LetPub ${paper.venue}: ${e.message}; retained verified cached rankings`);}
  }
  return {rankings:[...records.values()].sort((a,b)=>a.journal.localeCompare(b.journal)||b.year-a.year),warnings};
}
