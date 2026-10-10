import test from 'node:test';
import assert from 'node:assert/strict';
import {authorRole,renderPaper,updateHtml,collectManualAuthorRoles,highlightManualAuthor} from './sync-publications.mjs';
const config={authorNames:['Jiayin Li','李家印'],displayName:'Jiayin Li (李家印)'};
const paper={doi:'10.1234/test',title:'Example',date:'2024-01',year:2024,type:'journal-article',venue:'Journal',authors:[{name:'Other',self:false},{name:'Jiayin Li',self:true}],qualification:{eligible:true,evidence:[]}};
const card=(authors,note='')=>`<article class="publication"><h3>Example</h3><p class="authors">${authors}</p><p class="citation">Journal, 2024. ${note}</p><svg>Original figure</svg></article>`;
test('automatic first author is red and bold; middle/last author alone is not marked',()=>{
 assert.match(renderPaper({...paper,authors:[paper.authors[1],paper.authors[0]]},config),/<b class="author-lead" title="第一作者">Jiayin Li/);
 assert.doesNotMatch(renderPaper(paper,config),/author-lead/);
 assert.deepEqual(authorRole(paper),{first:false,corresponding:false});
});
test('verified correspondence and shared first authorship work by DOI or title; unverified claims do not',()=>{
 const proof={doi:paper.doi,corresponding:true,verified:true,source:'user-confirmed'};
 assert.match(renderPaper(paper,config,[proof]),/<b class="author-lead" title="通讯作者">Jiayin Li/);
 assert.doesNotMatch(renderPaper(paper,config,[{...proof,verified:false}]),/author-lead/);
 assert.doesNotMatch(renderPaper(paper,config,[{...proof,doi:'10.1234/other'}]),/author-lead/);
 assert.equal(authorRole(paper,[{title:paper.title,firstAuthor:true,verified:true,source:'user-confirmed'}]).first,true);
});
test('manual English and Chinese first/corresponding authors are highlighted with no changes to other authors',()=>{
 for(const name of ['Jiayin Li (李家印)','李家印']){
  const original=card(`<b>${name}</b>, Someone Else`);
  assert.match(highlightManualAuthor(original,config),/class="author-lead" title="第一作者"/);
  const corresponding=card(`Other, <b>${name}*</b>`, '(Corresponding Author)');
  const roles=collectManualAuthorRoles(corresponding,config);
  assert.equal(roles.length,1);assert.match(highlightManualAuthor(corresponding,config,roles),/title="通讯作者"/);
  assert.match(highlightManualAuthor(corresponding,config,roles),/Other, /);
 }
 assert.equal(collectManualAuthorRoles(card('Other*, <b>Jiayin Li</b>','Corresponding Author'),config).length,0);
 assert.doesNotMatch(highlightManualAuthor(card('Other, <b>Jiayin Li</b>'),config),/author-lead/);
});
test('repeat sync keeps manual markers, respects explicit corrections and preserves publication content',()=>{
 const html=`<section><h2 id="papers-heading">Publications</h2>${card('Other, <b>Jiayin Li*</b>','Corresponding Author')}</section>`;
 const changed=updateHtml(html,[],config);
 assert.match(changed,/title="通讯作者"/);assert.match(changed,/<svg>Original figure<\/svg>/);
 assert.equal(updateHtml(changed,[],config),changed);
 const corrected=updateHtml(changed,[],config,[{title:'Example',corresponding:false,verified:true,source:'user-confirmed'}]);
 assert.doesNotMatch(corrected,/author-lead/);
});
