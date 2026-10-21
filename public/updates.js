import {defaultClassification} from './timeline.mjs';
const find=selector=>document.querySelector(selector);
let checkSequence=0;
function showClassification(rules){
  const container=find('#classification-fields');container.replaceChildren();
  for(const [kind,title] of [['deadline','Deadlines'],['blocker','Blockers'],['sprint','Sprints']]){
    const fieldset=document.createElement('fieldset');fieldset.className='matching-rule';
    const legend=document.createElement('legend');legend.textContent=title;fieldset.append(legend);
    const grid=document.createElement('div');grid.className='matching-rule-grid';
    for(const [field,labelText] of [['labels','Label names'],['lists','List names'],['titlePrefixes','Title prefixes']]){
      const label=document.createElement('label');label.textContent=labelText;
      const input=document.createElement('input');input.type='text';input.id=`rule-${kind}-${field}`;
      input.value=(rules[kind]?.[field]||[]).join(', ');input.maxLength=500;input.autocomplete='off';
      input.placeholder='None';label.append(input);grid.append(label);
    }
    fieldset.append(grid);container.append(fieldset);
  }
}
function readClassification(){
  return Object.fromEntries(['deadline','blocker','sprint'].map(kind=>[kind,Object.fromEntries(['labels','lists','titlePrefixes'].map(field=>[field,find(`#rule-${kind}-${field}`).value.split(',').map(value=>value.trim()).filter(Boolean)]))]));
}
async function request(path,body){
  const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Roadmap-Request':'1'},body:JSON.stringify(body)}:{});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'The request failed.');
  return data;
}
async function loadVersion(){
  const info=await request('/api/version');
  const date=new Date(info.builtAt).toLocaleString('en-GB',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  find('#updated').textContent=`Version ${info.shortHash} · Build ${date}`;
  find('#updated').title=`Source ${info.hash}\nGit ${info.commit||'unavailable'}${info.dirty?' · local changes':''}`;
  find('#repository-url').value=info.settings.repository;
  find('#repository-branch').value=info.settings.branch;
  const classification=info.settings.classification||defaultClassification();
  showClassification(classification);
  window.dispatchEvent(new CustomEvent('trello-roadmap-settings',{detail:{classification}}));
  find('#build-details').textContent=`Git ${info.commit?.slice(0,12)||'unavailable'}${info.dirty?' · local changes':''}. Build date: ${date}.`;
}
async function checkUpdates(force=false){
  const sequence=++checkSequence;
  find('#check-updates').disabled=true;
  find('#update-status').textContent='Checking GitHub …';
  try{
    const result=await request('/api/updates'+(force?'?force=1':''));
    if(sequence!==checkSequence)return;
    find('#update-status').textContent=result.message+(result.dirty?' This checkout has local changes.':'');
    const notice=find('#update-notice');notice.replaceChildren();notice.hidden=!result.available;
    if(result.available){
      const message=document.createElement('span');message.textContent=result.message+' ';
      const link=document.createElement('a');link.href=result.repository;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open repository ↗';
      notice.append(message,link);
    }
  }catch(error){if(sequence===checkSequence)find('#update-status').textContent='Could not check for updates. '+error.message;}
  finally{if(sequence===checkSequence)find('#check-updates').disabled=false;}
}
function openSettings(){find('#app-settings').showModal();}
find('#app-settings-button').addEventListener('click',openSettings);
find('#updated').addEventListener('click',openSettings);
find('#close-app-settings').addEventListener('click',()=>find('#app-settings').close());
find('#check-updates').addEventListener('click',()=>checkUpdates(true));
find('#reset-classification').addEventListener('click',()=>showClassification(defaultClassification()));
find('#repository-form').addEventListener('submit',async event=>{
  event.preventDefault();find('#save-repository').disabled=true;++checkSequence;
  try{
    await request('/api/settings',{repository:find('#repository-url').value,branch:find('#repository-branch').value,classification:readClassification()});
    await loadVersion();await checkUpdates(true);
  }catch(error){find('#update-status').textContent=error.message;}
  finally{find('#save-repository').disabled=false;find('#check-updates').disabled=false;}
});
loadVersion().then(()=>checkUpdates()).catch(error=>{
  find('#updated').textContent='Build information unavailable';find('#update-status').textContent=error.message;
});
