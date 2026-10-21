export function dayNumber(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}
export function dateFromDay(day) { return new Date(day * 86400000); }

// Calendar columns always represent a local day. Use wall-clock time rather
// than elapsed milliseconds so DST days retain the same width as other days.
export function timePosition(value) {
  if (!value) return null;
  const day = dayNumber(value);
  if (day === null) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return day;
  const date = new Date(value);
  return day + (date.getHours()*3600 + date.getMinutes()*60 + date.getSeconds() + date.getMilliseconds()/1000)/86400;
}

export function timedInterval(card) {
  const days = interval(card);
  if (!days) return null;
  const due = timePosition(card.due);
  // Start is date-only in Trello; without a start, begin on the due day.
  const end = due === null ? days.end + 1
    : /^\d{4}-\d{2}-\d{2}$/.test(card.due) ? due + 1 : due;
  return {start:days.start,end:Math.max(days.start,end)};
}

export function cardGeometry(card, anchor, count, dayWidth) {
  const range = timedInterval(card);
  if (!range || range.start >= anchor+count || range.end < anchor
    || (range.end === anchor && range.start < range.end)) return null;
  const start = Math.max(anchor,range.start), end = Math.min(anchor+count,range.end);
  return {left:(start-anchor)*dayWidth,width:Math.max(2,(end-start)*dayWidth)};
}

export function deadlinePosition(card) {
  return timePosition(card.due) ?? timePosition(card.start);
}

export function interval(card) {
  const end = card.due ? dayNumber(card.due) : null;
  const start = card.start ? dayNumber(card.start) : null;
  if (start === null && end === null) return null;
  // A start-only card is shown on its start day; inverted ranges never create negative bars.
  return {start: start === null ? end : Math.min(start, end ?? start), end: end === null ? start : Math.max(end, start ?? end)};
}
export function packCards(cards) {
  const rows = [];
  return cards.map(card => ({card, range: interval(card)})).filter(item => item.range)
    .sort((a,b) => a.range.start-b.range.start || b.range.end-a.range.end || a.card.id.localeCompare(b.card.id))
    .map(item => {
      let row = rows.findIndex(end => end < item.range.start);
      if (row < 0) row = rows.length;
      rows[row] = item.range.end;
      return {...item, row};
    });
}
export function safeTrelloUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'trello.com' ? url.href : null; }
  catch { return null; }
}

export function defaultClassification(){
  return {deadline:{labels:['Deadline'],lists:[],titlePrefixes:['Deadline']},
    blocker:{labels:['Blocker'],lists:[],titlePrefixes:[]},
    sprint:{labels:['Sprint'],lists:[],titlePrefixes:[]}};
}
function matchesRule(card,rule,lists){
  if(!rule)return false;
  const normalize=value=>String(value||'').trim().toLocaleLowerCase();
  const labels=(card.labels||[]).map(label=>normalize(label.name));
  const listName=normalize(lists.find(list=>list.id===card.idList)?.name||card.listName);
  const title=normalize(card.name);
  return (rule.labels||[]).some(label=>labels.includes(normalize(label)))
    || (rule.lists||[]).some(list=>normalize(list)===listName&&listName)
    || (rule.titlePrefixes||[]).some(value=>{
      const prefix=normalize(value);
      if(!prefix||!title.startsWith(prefix))return false;
      const next=title.slice(prefix.length, prefix.length+1);
      return !next||!/[\p{L}_]/u.test(next);
    });
}
export const isDeadline=(card,rules=defaultClassification(),lists=[])=>matchesRule(card,rules.deadline,lists);
export const isBlocker=(card,rules=defaultClassification(),lists=[])=>matchesRule(card,rules.blocker,lists);
export const isSprint=(card,rules=defaultClassification(),lists=[])=>matchesRule(card,rules.sprint,lists);
export function cardKind(card,rules=defaultClassification(),lists=[]){
  return isBlocker(card,rules,lists)?'blocker':isSprint(card,rules,lists)?'sprint':isDeadline(card,rules,lists)?'deadline':'task';
}

export function blockerInterval(card) {
  const range=interval(card);
  return range?{start:range.start,end:range.end+1}:null;
}

export function memberDisplayName(member, aliases = {}) {
  return aliases[member.id]?.trim() || member.fullName || member.username || 'Unknown';
}

export function deadlineDay(card) {
  // A milestone belongs to the due day, even when the Trello card has a start date.
  return card.due ? dayNumber(card.due) : card.start ? dayNumber(card.start) : null;
}

export function placeEntries(entries, gap = 8) {
  const ends = [];
  const heights = [];
  const placed = [...entries].sort((a,b) => a.left-b.left || b.width-a.width).map(entry => {
    let lane = ends.findIndex(end => end + gap <= entry.left);
    if (lane < 0) lane = ends.length;
    ends[lane] = entry.left + entry.width;
    heights[lane] = Math.max(heights[lane] || 0, entry.height);
    return {...entry, lane};
  });
  const tops = [];let height = 16;
  for(const laneHeight of heights){tops.push(height);height += laneHeight + gap;}
  return {entries:placed.map(entry => ({...entry,top:tops[entry.lane]})),height:height+8};
}

export function minimapLayout(boards, hidden, start, end, rules=defaultClassification()) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {blocks:[],deadlines:[],blockers:[],sprints:[],lanes:1};
  const blocks=[],deadlines=[],blockers=[],sprints=[];
  let base=0;
  for(const board of boards){
    for(const card of board.cards.filter(card=>['blocker','sprint'].includes(cardKind(card,rules,board.lists||[])))){
      const range=cardKind(card,rules,board.lists||[])==='sprint'?timedInterval(card):blockerInterval(card);
      if(range&&range.start<end&&range.end>start){
        const left=Math.max(start,range.start),right=Math.min(end,range.end);
        (cardKind(card,rules,board.lists||[])==='sprint'?sprints:blockers).push({card,board,left:(left-start)/(end-start),width:(right-left)/(end-start)});
      }
    }
    for(const card of board.cards.filter(card=>cardKind(card,rules,board.lists||[])==='deadline')){
      const time=deadlinePosition(card);
      if(time!==null&&time>=start&&time<end)deadlines.push({card,board,position:(time-start)/(end-start)});
    }
    if(hidden[board.id])continue;
    const ends=[];
    const entries=board.cards.filter(card=>cardKind(card,rules,board.lists||[])==='task').map(card=>({card,range:timedInterval(card)}))
      .filter(({range})=>range&&range.start<end&&range.end>=start&&!(range.end===start&&range.start<range.end))
      .sort((a,b)=>a.range.start-b.range.start||b.range.end-a.range.end);
    for(const {card,range} of entries){
      const left=Math.max(start,range.start),right=Math.min(end,range.end);
      let lane=ends.findIndex(previous=>previous<=left);
      if(lane<0)lane=ends.length;
      ends[lane]=right;
      blocks.push({card,board,lane:base+lane,left:(left-start)/(end-start),width:(right-left)/(end-start)});
    }
    if(entries.length)base+=Math.max(2,ends.length)+1;
  }
  return {blocks,deadlines,blockers,sprints,lanes:Math.max(1,base-1)};
}

export function markerLabelLayout(markers,width,labelWidth=76,gap=6){
  const size=Math.min(labelWidth,width),ends=[];
  const labels=markers.map(marker=>({...marker,left:Math.max(0,Math.min(width-size,marker.position*width-size/2)),width:size}))
    .sort((a,b)=>a.left-b.left)
    .map(marker=>{
      let lane=ends.findIndex(end=>end+gap<=marker.left);
      if(lane<0)lane=ends.length;
      ends[lane]=marker.left+size;
      return {...marker,lane};
    });
  return {labels,lanes:ends.length};
}
