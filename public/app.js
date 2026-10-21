import './updates.js';
import {interval,dayNumber,dateFromDay,packCards,safeTrelloUrl,deadlineDay,deadlinePosition,cardGeometry,placeEntries,memberDisplayName,timePosition,timedInterval,minimapLayout,blockerInterval,markerLabelLayout,cardKind,defaultClassification} from './timeline.mjs';
const $ = selector => document.querySelector(selector);
let today = dayNumber(new Date());
const palette = ['#5cbf94','#dcaa60','#729fee','#bf8be0','#e58194','#65beca'];
let preferences;
try {
  // Preserve preferences saved before the application was renamed.
  const saved=localStorage.getItem('trello-roadmap-preferences') ?? localStorage.getItem('orbit-preferences');
  preferences=JSON.parse(saved || '{}');
  if(saved && !localStorage.getItem('trello-roadmap-preferences'))localStorage.setItem('trello-roadmap-preferences',saved);
} catch { preferences = {}; }
preferences.colors ||= {}; preferences.hidden ||= {};
preferences.aliases ||= {};
preferences.minimapRanges ||= {};
let boards = [], demo = false, connected = false, loading = false, generation = 0;
let minimapDeadlineMarkers=[];
let minimapSprints=[];
let classification=defaultClassification();
const kindFor=(card,board)=>cardKind(card,classification,board.lists||[]);
let zoom = preferences.zoom || 'days';
if (!['days','weeks','months'].includes(zoom)) zoom = 'days';
let anchor = today - 7;
const dayWidth = () => ({days:52,weeks:28,months:11}[zoom]);
const dayCount = () => ({days:98,weeks:182,months:400}[zoom]);
const format = (day, options) => dateFromDay(day).toLocaleDateString('en-GB', {...options,timeZone:'UTC'});
const save = () => { try {localStorage.setItem('trello-roadmap-preferences',JSON.stringify({...preferences,zoom}));} catch {} };
const node = (tag, className, text) => {const element = document.createElement(tag); if(className) element.className=className; if(text !== undefined) element.textContent=text; return element;};
function notice(text, error=false) { $('#notice').textContent=text; $('#notice').hidden=!text; $('#notice').classList.toggle('error',error); }
async function api(path, body) {
  const response = await fetch(path, body ? {method:'POST', headers:{'Content-Type':'application/json','X-Roadmap-Request':'1'},body:JSON.stringify(body)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}
function colorFor(board) { return /^#[\da-f]{6}$/i.test(preferences.colors[board.id] || '') ? preferences.colors[board.id] : palette[boards.indexOf(board)%palette.length]; }
function makeDemo() {
  const definitions = [
    ['Backend, DB & AI',[['User-Accounts',0,10,'BACKLOG',false,'KK'],['Research · Integration Tests',0,8,'TODO',false,'ML'],['Research · Unit Tests',1,8,'TODO',false,'JK'],['Align API interfaces',11,15,'TODO',false,'ML']]],
    ['Project management',[['Add project details to the documentation',2,21,'TODO',false,'JK'],['Budget planning',7,21,'TODO',false,'ML'],['Prepare progress review',7,21,'DELIVERABLES',false,'KK'],['Set up presentation structure',2,21,'TODO',false,'JK'],['Team meeting',7,7,'MEETINGS',false,'ML'],['Sprint Review',14,14,'MEETINGS',false,'ML']]],
    ['UI/UX & Frontend',[['Flutter-Projekt-Setup',0,2,'DONE',true,'JK'],['Research accessibility principles',2,21,'TODO',false,'ML'],['Define the first use cases',2,21,'TODO',false,'KK'],['Research UX principles',7,21,'TODO',false,'ML'],['Analyze similar platforms',2,10,'TODO',false,'KK'],['Create wireframes for key views',7,21,'TODO',false,'JK'],['Define UI style in Figma',7,15,'TODO',false,'JK'],['Set up app structure',2,4,'DONE',true,'ML'],['Define colors and styling',14,21,'TODO',false,'JK']]]
  ];
  const fullNames={'JK':'Jana König','ML':'Mika Lorenz','KK':'Kim Keller'};
  const demoDate=(day,hour)=>{const date=dateFromDay(day);return new Date(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour).toISOString();};
  const result=definitions.map(([name,cards],index)=>({id:'demo'+index,name,lists:['TODO','BACKLOG','DELIVERABLES','MEETINGS','DONE'].map(name=>({id:name,name})),members:['JK','ML','KK'].map(initials=>({id:initials,initials,fullName:fullNames[initials]})),cards:cards.map(([name,start,end,idList,dueComplete,member],i)=>({id:`${index}-${i}`,name,start:demoDate(today-7+start,0),due:demoDate(today-7+end,start===end?10:18),idList,dueComplete,idMembers:i===0?['JK','ML','KK']:[member],labels:[],url:null}))}));
  result[1].cards.push({id:'demo-deadline',name:'Deadline 1',start:demoDate(today-3,0),due:demoDate(today+4,18),dueComplete:false,idList:'DELIVERABLES',idMembers:['JK','ML'],labels:[],url:null});
  result[1].cards.push({id:'demo-blocker',name:'Christmas & New Year',start:'2026-12-21T12:00:00',due:'2027-01-03T09:00:00',dueComplete:false,idList:'MEETINGS',idMembers:[],labels:[{name:'Blocker'}],url:null});
  for(let i=0;i<3;i++)result[1].cards.push({id:'demo-sprint-'+i,name:'Sprint '+(i+1),start:demoDate(today-7+i*14,8),due:demoDate(today+6+i*14,18),dueComplete:false,idList:'MEETINGS',idMembers:[],labels:[{name:'Sprint'}],url:null});
  return result;
}

function cardDetails(card,board,range) {
  const list=board.lists.find(list=>list.id===card.idList)?.name || '';
  const members=(card.idMembers||[]).map(id=>board.members.find(member=>member.id===id)).filter(Boolean);
  const names=members.map(member=>memberDisplayName(member,preferences.aliases)).join(', ');
  const dueTime=card.due?new Date(card.due).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'';
  const period=format(range.start,{day:'numeric',month:'short'})+(range.end!==range.start?' – '+format(range.end,{day:'numeric',month:'short'}):'')+(dueTime?' · '+dueTime:'');
  return {list,names,period,description:`${card.name}\n${period}\n${board.name} / ${list}${card.dueComplete?' · Complete':''}${names?'\n'+names:''}`};
}

function entryLink(card,className,description) {
  const href=safeTrelloUrl(card.url),entry=node(href?'a':'div',className+(card.dueComplete?' completed':''));
  if(href){entry.href=href;entry.target='_blank';entry.rel='noopener noreferrer';}
  else entry.tabIndex=0;
  entry.title=description;
  entry.setAttribute('aria-label',description+(href?' · Open in Trello':''));
  return entry;
}

function finishTrack(track,entries,row,gap=8) {
  const layout=placeEntries(entries.map(entry=>({...entry,height:Math.ceil(entry.copy.getBoundingClientRect().height)})),gap);
  for(const entry of layout.entries){entry.element.style.left=entry.left+'px';entry.element.style.top=entry.top+'px';entry.element.style.height=entry.height+'px';}
  row.style.height=Math.max(60,layout.height)+'px';
}

function sprintPeriod(card){
  const days=interval(card);
  const period=format(days.start,{day:'numeric',month:'short',year:'numeric'})+' – '+format(days.end,{day:'numeric',month:'short',year:'numeric'});
  return period+(card.due?' · '+new Date(card.due).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):'');
}

function renderPeriodRow(timeline,kind,items,width,count,deadlines,blockers){
  if(!items.length)return;
  const gridWidth=count*width,row=node('div','board-row '+kind+'-row');row.style.width=`calc(var(--label) + ${gridWidth}px)`;
  const label=node('div','board-label'),title=node('div','board-name',kind==='sprint'?'▰ Sprints':'▧ Blockers');
  title.append(node('div','board-sub',`${items.length} in this range`));label.append(title);
  const track=node('div','board-track '+kind+'-track');track.style.width=gridWidth+'px';track.style.setProperty('--day-width',width+'px');
  row.append(label,track);timeline.append(row);addGrid(track,width,count,deadlines,blockers);
  const entries=[];
  for(const {card,board,range} of items){
    const period=kind==='sprint'?sprintPeriod(card):format(range.start,{day:'numeric',month:'short',year:'numeric'})+' – '+format(range.end-1,{day:'numeric',month:'short',year:'numeric'})+' · All day';
    const entry=entryLink(card,kind+'-entry',`${card.name}\n${period}\n${board.name}`);
    const actualLeft=(Math.max(anchor,range.start)-anchor)*width,actualWidth=(Math.min(anchor+count,range.end)-Math.max(anchor,range.start))*width;
    const copy=node('div',kind+'-copy');copy.style.width=kind==='sprint'?actualWidth+'px':'max-content';
    if(kind==='blocker')copy.style.maxWidth='310px';
    copy.append(node('span','card-name',card.name),node('div','card-meta',period));
    const span=node('span',kind+'-span');span.style.width=actualWidth+'px';
    entry.append(span,copy);track.append(entry);
    const labelWidth=Math.max(actualWidth,Math.ceil(copy.getBoundingClientRect().width));
    const left=kind==='sprint'?actualLeft:Math.max(0,Math.min(actualLeft,gridWidth-labelWidth));
    span.style.left=actualLeft-left+'px';entry.style.width=labelWidth+'px';
    entries.push({element:entry,copy,left,width:labelWidth});
  }
  finishTrack(track,entries,row,kind==='sprint'?0:8);
}

function addGrid(track,width,count,deadlines,blockers=[]) {
  for(const {range,card} of blockers){
    const shade=node('div','blocker-shade');
    shade.style.left=(Math.max(anchor,range.start)-anchor)*width+'px';
    shade.style.width=(Math.min(anchor+count,range.end)-Math.max(anchor,range.start))*width+'px';
    shade.setAttribute('aria-hidden','true');track.append(shade);
  }
  for(let offset=0;offset<count;offset++) if([0,6].includes(dateFromDay(anchor+offset).getUTCDay())){const weekend=node('div','weekend');weekend.style.left=offset*width+'px';weekend.style.width=width+'px';track.append(weekend);}
  const now=timePosition(new Date()),line=node('div','today-line');
  line.hidden=now<anchor||now>=anchor+count;
  line.style.left=(now-anchor)*width+'px';line.setAttribute('aria-hidden','true');track.append(line);
  for(const {position} of deadlines){const line=node('div','deadline-line');line.style.left=(position-anchor)*width+'px';track.append(line);}
}
function renderPicker() {
  $('#board-options').replaceChildren();
  for (const board of boards) {
    const option=node('div','board-option'), label=node('label'), toggle=node('input');toggle.type='checkbox'; toggle.checked=!preferences.hidden[board.id];
    toggle.addEventListener('change',()=>{preferences.hidden[board.id]=!toggle.checked;save();render();});
    label.append(toggle,document.createTextNode(board.name));
    const color=node('input');color.type='color';color.value=colorFor(board);color.setAttribute('aria-label','Color for '+board.name);
    color.addEventListener('input',()=>{preferences.colors[board.id]=color.value;save();render();});
    option.append(label,color);$('#board-options').append(option);
  }
}

const minimapKey=()=>demo?'__demo__':$('#workspace').value||preferences.workspace||'__default__';
function loadedCardDates(){
  let start=Infinity,end=-Infinity;
  for(const board of boards)for(const card of board.cards){
    const range=interval(card);
    if(range){start=Math.min(start,range.start);end=Math.max(end,range.end);}
  }
  return Number.isFinite(start)?{start,end}:null;
}

function minimapRange(){
  const saved=preferences.minimapRanges[minimapKey()];
  if(saved&&/^\d{4}-\d{2}-\d{2}$/.test(saved.start)&&/^\d{4}-\d{2}-\d{2}$/.test(saved.end)){
    const start=dayNumber(saved.start+'T00:00:00'),end=dayNumber(saved.end+'T00:00:00');
    if(start!==null&&end!==null&&end>=start)return {start,end:end+1};
  }
  let start=Infinity,end=-Infinity;
  for(const board of boards)for(const card of board.cards){
    const range=kindFor(card,board)==='blocker'?blockerInterval(card):timedInterval(card);
    if(range){start=Math.min(start,range.start);end=Math.max(end,Math.ceil(range.end));}
  }
  return Number.isFinite(start)?{start,end:Math.max(start+1,end)}:{start:today-7,end:today+29};
}
function updateMinimapNow(){
  const line=$('#minimap-plot .minimap-now');
  if(!line)return;
  const start=Number($('#minimap-plot').dataset.start),end=Number($('#minimap-plot').dataset.end),now=timePosition(new Date());
  line.hidden=now<start||now>=end;
  line.style.left=((now-start)/(end-start)*100)+'%';
}
function renderMinimapDeadlineDates(){
  const axis=$('#minimap-deadline-dates');axis.replaceChildren();
  if($('#minimap').hidden||$('#minimap-plot').hidden)return;
  const width=$('#minimap-plot').getBoundingClientRect().width;
  if(!width)return;
  const layout=markerLabelLayout(minimapDeadlineMarkers,width);
  axis.style.height=(layout.lanes?layout.lanes*21+5:0)+'px';
  for(const {card,board,position,left,lane,width:labelWidth} of layout.labels){
    const value=card.due||card.start,date=new Date(value);
    const text=date.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
    const label=node('span','minimap-deadline-date',text);
    label.style.left=left+'px';label.style.top=(5+lane*21)+'px';label.style.width=labelWidth+'px';
    label.title=`${card.name} · ${board.name}\n${date.toLocaleString('en-GB')}`;
    label.setAttribute('aria-label',card.name+': '+text);
    const stem=node('span','minimap-deadline-stem');stem.style.left=position*100+'%';stem.style.height=(4+lane*21)+'px';
    axis.append(stem,label);
  }
}
function renderMinimapSprints(){
  const band=$('#minimap-sprints');band.replaceChildren();
  band.hidden=$('#minimap').hidden||$('#minimap-plot').hidden||!minimapSprints.length;
  if(band.hidden)return;
  const width=$('#minimap-plot').getBoundingClientRect().width;
  const layout=placeEntries(minimapSprints.map(item=>({...item,left:item.left*width,width:item.width*width,height:20})),0);
  band.style.height=Math.max(24,layout.height-12)+'px';
  for(const {card,board,left,width:spanWidth,top} of layout.entries){
    const period=sprintPeriod(card);
    const entry=entryLink(card,'minimap-sprint',`${card.name}\n${period}\n${board.name}`);
    entry.style.left=left+'px';entry.style.width=spanWidth+'px';entry.style.top=(top-12)+'px';entry.textContent=card.name;
    band.append(entry);
  }
}
function renderMinimapAnnotations(){renderMinimapDeadlineDates();renderMinimapSprints();}
function renderMinimap(){
  const enabled=preferences.showMinimap===true;
  $('#show-minimap').checked=enabled;$('#minimap').hidden=!enabled;
  $('#minimap-open').hidden=enabled;
  if(!enabled)return;
  $('#minimap-fit').disabled=loading||!loadedCardDates();
  const range=minimapRange(),plot=$('#minimap-plot'),axis=$('#minimap-axis');
  $('#minimap-start').value=dateFromDay(range.start).toISOString().slice(0,10);
  $('#minimap-end').value=dateFromDay(range.end-1).toISOString().slice(0,10);
  $('#minimap-start').max=$('#minimap-end').value;$('#minimap-end').min=$('#minimap-start').value;
  $('#minimap-error').hidden=true;plot.hidden=false;axis.hidden=false;$('#minimap-deadline-dates').hidden=false;
  plot.dataset.start=range.start;plot.dataset.end=range.end;
  plot.replaceChildren();axis.replaceChildren();
  const model=minimapLayout(boards,preferences.hidden,range.start,range.end,classification);
  minimapDeadlineMarkers=model.deadlines;
  minimapSprints=model.sprints;
  plot.style.setProperty('--mini-lanes',model.lanes);
  for(const {card,left,width} of model.blockers){
    const shade=node('div','minimap-blocker');shade.style.left=left*100+'%';shade.style.width=width*100+'%';
    shade.title=card.name;plot.append(shade);
  }
  for(const {card,board,lane,left,width} of model.blocks){
    const block=node('div','minimap-block'+(card.dueComplete?' completed':''));
    block.style.left=left*100+'%';block.style.width=`min(${(1-left)*100}%, max(2px, ${width*100}%))`;
    block.style.top=`calc(${lane/model.lanes*100}% + 1px)`;block.style.background=colorFor(board);
    block.title=cardDetails(card,board,{start:dayNumber(card.start||card.due),end:dayNumber(card.due||card.start)}).description;
    plot.append(block);
  }
  for(const {card,board,position} of model.deadlines){
    const line=node('div','minimap-deadline');line.style.left=position*100+'%';
    line.title=`${card.name} · ${board.name}\n${new Date(card.due||card.start).toLocaleString('en-GB')}`;plot.append(line);
  }
  if(!model.blocks.length&&!model.deadlines.length&&!model.blockers.length&&!model.sprints.length)plot.append(node('div','minimap-empty',loading?'Loading dates …':'No scheduled items in this range'));
  plot.append(node('div','minimap-now'));updateMinimapNow();
  for(let index=0;index<=4;index++){
    const day=range.start+Math.round((range.end-range.start-1)*index/4);
    const tick=node('span','minimap-tick',format(day,{day:'numeric',month:'short',year:index===0||index===4?'numeric':undefined}));
    tick.style.left=index*25+'%';axis.append(tick);
  }
  renderMinimapAnnotations();
}
function render() {
  today=dayNumber(new Date());
  renderMinimap();
  $('#timeline').classList.toggle('names-hidden',preferences.showMembers===false);
  $('#timeline').classList.toggle('details-hidden',preferences.showDetails===false);
  $('#show-members').checked=preferences.showMembers!==false;
  $('#show-details').checked=preferences.showDetails!==false;
  document.querySelectorAll('[data-zoom]').forEach(button=>{button.classList.toggle('active',button.dataset.zoom===zoom);button.setAttribute('aria-pressed',button.dataset.zoom===zoom);});
  const visible=boards.filter(board=>!preferences.hidden[board.id]);
  $('#board-count').textContent=`${visible.length}/${boards.length}`;
  const width=dayWidth(), count=dayCount(), end=anchor+count-1, gridWidth=count*width;
  // Board switches only filter task lanes; milestones belong to the workspace.
  const deadlines=boards.flatMap(board=>board.cards.filter(card=>kindFor(card,board)==='deadline').map(card=>({card,board,day:deadlineDay(card),position:deadlinePosition(card)})))
    .filter(({position})=>position!==null&&position>=anchor&&position<anchor+count);
  const blockers=boards.flatMap(board=>board.cards.filter(card=>kindFor(card,board)==='blocker').map(card=>({card,board,range:blockerInterval(card)})))
    .filter(({range})=>range&&range.start<anchor+count&&range.end>anchor);
  const sprints=boards.flatMap(board=>board.cards.filter(card=>kindFor(card,board)==='sprint').map(card=>({card,board,range:timedInterval(card)})))
    .filter(({range})=>range&&range.start<anchor+count&&range.end>anchor);
  $('#period').textContent=format(anchor,{month:'long',year:'numeric'}) + (format(anchor,{month:'long'})!==format(end,{month:'long'})?' – '+format(end,{month:'short',year:'numeric'}):'');
  const timeline=$('#timeline');timeline.replaceChildren();
  if (!visible.length && !deadlines.length && !blockers.length && !sprints.length) {
    const empty=node('div','empty');empty.append(node('h3','',loading?'Loading roadmap …':boards.length?'All boards are hidden':connected?'No boards loaded yet':'Your boards. One shared plan.'),node('p','',boards.length?'Use “Boards” to show them again.':connected?'Select a workspace with active boards.':'Connect Trello or explore sample data.'));timeline.append(empty);$('#card-count').textContent='';return;
  }
  const head=node('div','timeline-head');head.style.width=`calc(var(--label) + ${gridWidth}px)`;head.append(node('div','corner','BOARDS / '+visible.length));
  const dates=node('div','dates');dates.style.width=gridWidth+'px';
  for(let offset=0;offset<count;offset++) {
    const day=anchor+offset, date=dateFromDay(day);
    if(offset===0||date.getUTCDate()===1) {const month=node('div','month-label',format(day,{month:'long',year:'numeric'}));month.style.left=offset*width+10+'px';dates.append(month);}
    if(zoom==='months'&&date.getUTCDay()!==1) continue;
    const label=node('div','day-label'+(day===today?' today':''));label.style.left=offset*width+'px';label.style.width=(zoom==='months'?width*3:width)+'px';
    if(zoom==='days')label.append(node('span','',format(day,{weekday:'short'}).replace('.','')));
    label.append(node('span','date-number',format(day,{day:'numeric'})));dates.append(label);
  }
  head.append(dates);timeline.append(head);
  renderPeriodRow(timeline,'sprint',sprints,width,count,deadlines,blockers);
  renderPeriodRow(timeline,'blocker',blockers,width,count,deadlines,blockers);
  if(deadlines.length){
    const row=node('div','board-row deadline-row');row.style.width=`calc(var(--label) + ${gridWidth}px)`;
    const label=node('div','board-label');const title=node('div','board-name','◇ Deadlines');title.append(node('div','board-sub',`${deadlines.length} in this range`));label.append(title);
    const track=node('div','board-track deadline-track');track.style.width=gridWidth+'px';track.style.setProperty('--day-width',width+'px');row.append(label,track);timeline.append(row);addGrid(track,width,count,deadlines,blockers);
    const entries=[];
    for(const {card,board,day,position} of deadlines){
      const details=cardDetails(card,board,{start:day,end:day});
      const entry=entryLink(card,'deadline-entry',details.description);
      const point=(position-anchor)*width;
      const diamond=node('span','deadline-diamond','◆');
      const copy=node('div','deadline-copy');copy.style.width='max-content';copy.style.maxWidth='310px';
      copy.append(node('span','card-name',card.name),node('div','card-meta',`${board.name} · ${details.period}`));
      if(details.names)copy.append(node('div','card-members',details.names));
      entry.style.setProperty('--card-color',colorFor(board));entry.append(diamond,copy);track.append(entry);
      const labelWidth=Math.ceil(copy.getBoundingClientRect().width);
      const toRight=point+labelWidth+14<=gridWidth;
      const left=toRight?point-6:point-labelWidth-14;
      copy.style.marginLeft=(toRight?20:0)+'px';diamond.style.left=point-left-6+'px';
      entry.style.width=(labelWidth+20)+'px';
      entries.push({element:entry,copy,left,width:labelWidth+20});
    }
    finishTrack(track,entries,row);
  }
  let total=0;
  for(const board of visible) {
    const all=packCards(board.cards.filter(card=>kindFor(card,board)==='task')), items=all.filter(({card})=>cardGeometry(card,anchor,count,width));
    const row=node('div','board-row');row.style.width=`calc(var(--label) + ${gridWidth}px)`;
    const label=node('div','board-label'), dot=node('span','board-dot');dot.style.background=colorFor(board);
    const title=node('div','board-name',board.name);title.append(node('div','board-sub',`${all.length} scheduled cards`));label.append(dot,title);row.append(label);
    const track=node('div','board-track');track.style.width=gridWidth+'px';track.style.setProperty('--day-width',width+'px');
    row.append(track);timeline.append(row);addGrid(track,width,count,deadlines,blockers);
    const entries=[];
    for(const {card,range} of items) {
      const details=cardDetails(card,board,range);
      const bar=entryLink(card,'card',details.description);
      const {left:actualLeft,width:actualWidth}=cardGeometry(card,anchor,count,width);
      const external=actualWidth<240;
      const copy=node('div','card-copy');
      copy.style.width=external?'max-content':actualWidth+'px';
      if(external)copy.style.maxWidth='300px';
      copy.append(node('span','card-name',card.name),node('div','card-meta',(card.dueComplete?'✓ ':'')+details.list+' · '+details.period));
      if(details.names)copy.append(node('div','card-members',details.names));
      bar.classList.toggle('external-label',external);bar.style.setProperty('--card-color',colorFor(board));
      const span=node('span','card-span');span.style.width=actualWidth+'px';
      bar.append(span,copy);track.append(bar);
      const labelWidth=Math.ceil(copy.getBoundingClientRect().width),entryWidth=Math.max(actualWidth,labelWidth);
      const before=actualLeft+entryWidth>gridWidth;
      const left=before?Math.max(0,actualLeft+actualWidth-entryWidth):actualLeft;
      span.style.left=actualLeft-left+'px';
      bar.style.setProperty('--duration-width',actualWidth+'px');bar.style.width=entryWidth+'px';
      entries.push({element:bar,copy,left,width:entryWidth});total++;
    }
    if(!items.length){const message=node('div','muted','No tasks in this range');message.style.padding='24px';track.append(message);}
    finishTrack(track,entries,row);
  }
  $('#card-count').textContent=total+' tasks · '+deadlines.length+(deadlines.length===1?' Deadline':' Deadlines')+(blockers.length?' · '+blockers.length+' Blocker':'')+(sprints.length?' · '+sprints.length+' Sprints':'');
}
async function loadWorkspace() {
  const version=++generation;
  const workspace=$('#workspace').value;
  if(!workspace)return;
  preferences.workspace=workspace;save();loading=true;boards=[];render();notice('Loading boards and dates from Trello …');
  try {
    const result=await api('/api/roadmap?workspace='+encodeURIComponent(workspace));
    if(version!==generation)return;
    if(result.boards.some(board=>board.cards.some(card=>!Array.isArray(card.labels)))){
      throw new Error('The local server is missing Trello labels. Restart the Roadmap server and refresh to correctly detect blockers and deadlines.');
    }
    boards=result.boards;notice('');
  } catch(error){if(version===generation)notice(error.message,true);}
  finally{if(version===generation){loading=false;renderPicker();render();}}
}
async function loadWorkspaces() {
  const version=generation;
  const workspaces=await api('/api/workspaces');
  if(version!==generation||demo)return;
  $('#workspace').replaceChildren();
  for(const workspace of workspaces){const option=node('option','',workspace.displayName||workspace.name);option.value=workspace.id;$('#workspace').append(option);}
  if(workspaces.some(workspace=>workspace.id===preferences.workspace))$('#workspace').value=preferences.workspace;
  if(workspaces.length)await loadWorkspace();else notice('No workspaces were found for this Trello account.');
}
function setup(){$('#disconnect').hidden=!connected;$('#setup-error').hidden=true;$('#setup').showModal();}
$('#settings-button').addEventListener('click',setup);
$('#close-setup').addEventListener('click',()=>$('#setup').close());
// Only dismiss a backdrop gesture when it starts and ends outside the dialog.
for(const dialog of document.querySelectorAll('dialog')){
  let startedOutside=false;
  const outside=event=>{
    const rect=dialog.getBoundingClientRect();
    return event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;
  };
  dialog.addEventListener('pointerdown',event=>{startedOutside=event.target===dialog&&outside(event);});
  dialog.addEventListener('click',event=>{
    if(startedOutside&&event.target===dialog&&outside(event))dialog.close();
    startedOutside=false;
  });
  dialog.addEventListener('close',()=>{startedOutside=false;});
}
document.addEventListener('pointerdown',event=>{
  if(!$('#minimap').hidden&&!document.querySelector('dialog[open]')&&!event.target.closest('#minimap,#minimap-open,#view-picker,#view-button')){
    preferences.showMinimap=false;save();renderMinimap();
  }
});

$('#workspace').addEventListener('change',()=>{if(!demo)loadWorkspace();});
function closePickers(except) {
  for(const name of ['boards','view'])if(name!==except){$('#'+(name==='boards'?'board':'view')+'-picker').hidden=true;$('#'+name+'-button').setAttribute('aria-expanded','false');}
}
for(const name of ['boards','view'])$('#'+name+'-button').addEventListener('click',()=>{
  const picker=$('#'+(name==='boards'?'board':'view')+'-picker');
  const hidden=!picker.hidden;closePickers(name);picker.hidden=hidden;$('#'+name+'-button').setAttribute('aria-expanded',String(!hidden));
});
document.addEventListener('click',event=>{if(!event.target.closest('#board-picker,#boards-button,#view-picker,#view-button'))closePickers();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){
  closePickers();
  if(!$('#minimap').hidden&&!$('#setup').open&&!$('#aliases-dialog').open&&!$('#app-settings').open){preferences.showMinimap=false;save();renderMinimap();}
}});
$('#show-members').addEventListener('change',event=>{preferences.showMembers=event.target.checked;save();render();});
$('#show-details').addEventListener('change',event=>{preferences.showDetails=event.target.checked;save();render();});
$('#show-minimap').addEventListener('change',event=>{preferences.showMinimap=event.target.checked;save();renderMinimap();});
$('#minimap-open').addEventListener('click',()=>{preferences.showMinimap=true;save();renderMinimap();});
$('#minimap-close').addEventListener('click',()=>{preferences.showMinimap=false;save();renderMinimap();});
$('#minimap-fit').addEventListener('click',()=>{
  const range=loadedCardDates();if(!range)return;
  preferences.minimapRanges[minimapKey()]={
    start:dateFromDay(range.start).toISOString().slice(0,10),
    end:dateFromDay(range.end).toISOString().slice(0,10)
  };
  save();renderMinimap();
});

for(const input of [$('#minimap-start'),$('#minimap-end')])input.addEventListener('change',()=>{
  const start=$('#minimap-start').value,end=$('#minimap-end').value;
  if(!start||!end||end<start){
    $('#minimap-error').textContent='Choose a valid date range: the end must be on or after the start.';
    $('#minimap-error').hidden=false;$('#minimap-plot').hidden=true;$('#minimap-axis').hidden=true;$('#minimap-deadline-dates').hidden=true;$('#minimap-sprints').hidden=true;return;
  }
  preferences.minimapRanges[minimapKey()]={start,end};save();renderMinimap();
});
$('#aliases-button').addEventListener('click',()=>{
  closePickers();const container=$('#alias-inputs');container.replaceChildren();
  const members=[...new Map(boards.flatMap(board=>board.members).map(member=>[member.id,member])).values()]
    .sort((a,b)=>memberDisplayName(a).localeCompare(memberDisplayName(b),'en'));
  if(!members.length)container.append(node('p','','Load a workspace first to customize assignee names.'));
  for(const member of members){
    const label=node('label','alias-label',memberDisplayName(member)+(member.username&&member.username!==member.fullName?' (@'+member.username+')':''));
    const input=node('input');input.type='text';input.maxLength=100;input.dataset.memberId=member.id;
    input.placeholder=memberDisplayName(member);input.value=preferences.aliases[member.id]||'';
    input.autocomplete='off';label.append(input);container.append(label);
  }
  $('#aliases-dialog').showModal();
});
$('#close-aliases').addEventListener('click',()=>$('#aliases-dialog').close());
$('#aliases-form').addEventListener('submit',event=>{
  event.preventDefault();for(const input of $('#alias-inputs').querySelectorAll('input')){
    const value=input.value.trim();if(value)preferences.aliases[input.dataset.memberId]=value;else delete preferences.aliases[input.dataset.memberId];
  }
  save();$('#aliases-dialog').close();render();
});
$('#show-all').addEventListener('click',()=>{for(const board of boards)preferences.hidden[board.id]=false;save();renderPicker();render();});
$('#today').addEventListener('click',()=>{today=dayNumber(new Date());anchor=today-7;render();$('#timeline-scroll').scrollLeft=0;});
$('#previous').addEventListener('click',()=>{anchor-=zoom==='days'?14:zoom==='weeks'?28:90;render();$('#timeline-scroll').scrollLeft=0;});
$('#next').addEventListener('click',()=>{anchor+=zoom==='days'?14:zoom==='weeks'?28:90;render();$('#timeline-scroll').scrollLeft=0;});
document.querySelectorAll('[data-zoom]').forEach(button=>button.addEventListener('click',()=>{zoom=button.dataset.zoom;save();render();$('#timeline-scroll').scrollLeft=0;}));
$('#authorize').addEventListener('click',()=>{const key=$('#api-key').value.trim();if(!/^[a-f\d]{32}$/i.test(key)){$('#setup-error').textContent='Enter a valid API key first.';$('#setup-error').hidden=false;return;}const query=new URLSearchParams({key,name:'Trello Roadmap',scope:'read',expiration:'never',response_type:'token'});window.open('https://trello.com/1/authorize?'+query,'_blank','noopener,noreferrer');});
$('#connection-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#connect').disabled=true;$('#connect').textContent='Checking connection …';$('#setup-error').hidden=true;
  try{await api('/api/connect',{key:$('#api-key').value,token:$('#api-token').value});$('#api-key').value='';$('#api-token').value='';connected=true;demo=false;$('#setup').close();$('#connection-label').textContent='Trello connected · read-only';$('#footer-hint').textContent='Click a card to open it in Trello';await loadWorkspaces();}
  catch(error){if($('#setup').open){$('#setup-error').textContent=error.message;$('#setup-error').hidden=false;}else notice(error.message,true);}
  finally{$('#connect').disabled=false;$('#connect').textContent='Connect Trello →';}
});
$('#disconnect').addEventListener('click',async()=>{try{await api('/api/disconnect',{});generation++;connected=false;demo=false;boards=[];$('#workspace').replaceChildren(node('option','','Connect Trello …'));$('#connection-label').textContent='Local · read-only';$('#disconnect').hidden=true;notice('Local connection removed.');renderPicker();render();}catch(error){$('#setup-error').textContent=error.message;$('#setup-error').hidden=false;}});
$('#demo').addEventListener('click',()=>{generation++;demo=true;loading=false;boards=makeDemo();$('#workspace').replaceChildren(node('option','','Sample · Project team'));$('#setup').close();$('#connection-label').textContent='Sample data · local preview';$('#footer-hint').textContent='Sample data · cards are not linked to Trello';notice('Previewing sample data. Use “Connection” to load your Trello boards.');anchor=today-7;renderPicker();render();});
function updateNowLine() {
  const now=new Date(),day=dayNumber(now);
  // Only rebuild the calendar at midnight; ordinary ticks preserve the DOM and scroll position.
  if(day!==today)render();
  const position=timePosition(now),width=dayWidth();
  for(const line of document.querySelectorAll('.today-line')){
    line.hidden=position<anchor||position>=anchor+dayCount();
    line.style.left=(position-anchor)*width+'px';
  }
  $('#now-label').textContent='Now · '+now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  updateMinimapNow();
}
setInterval(updateNowLine,60_000);
new ResizeObserver(renderMinimapAnnotations).observe($('#minimap-plot'));
window.addEventListener('trello-roadmap-settings',event=>{classification=event.detail.classification||defaultClassification();render();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateNowLine();});
window.addEventListener('focus',updateNowLine);
render();
updateNowLine();
try{const status=await api('/api/status');connected=status.connected;if(connected){$('#connection-label').textContent='Trello connected · read-only';await loadWorkspaces();}else setup();}catch(error){notice(error.message,true);}
