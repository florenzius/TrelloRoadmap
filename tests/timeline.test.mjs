import test from 'node:test';
import assert from 'node:assert/strict';
import {dayNumber,interval,packCards,safeTrelloUrl,isDeadline,deadlineDay,placeEntries,memberDisplayName,timePosition,timedInterval,cardGeometry,deadlinePosition,minimapLayout,isBlocker,blockerInterval,markerLabelLayout,defaultClassification,cardKind,isSprint} from '../public/timeline.mjs';
test('undated cards disappear; due-only cards occupy one day',()=>{
  assert.equal(interval({}),null);
  const due='2026-10-19T12:00:00';const day=dayNumber(due);
  assert.deepEqual(interval({due}),{start:day,end:day});
  assert.deepEqual(interval({start:due}),{start:day,end:day});
});
test('overlapping endpoints require separate lanes; adjacent dates reuse lanes',()=>{
  const result=packCards([{id:'a',start:'2026-10-19',due:'2026-10-21'}, {id:'b',due:'2026-10-21'},{id:'c',due:'2026-10-22'},{id:'d'}]);
  assert.equal(result.length,3);assert.equal(result[0].row,0);assert.equal(result[1].row,1);assert.equal(result[2].row,0);
});
test('invalid dates and inverted periods cannot break layout',()=>{
  assert.equal(interval({due:'invalid'}),null);
  const range=interval({start:'2026-10-22',due:'2026-10-19'});assert.ok(range.end>=range.start);
});
test('card links only open HTTPS Trello URLs',()=>{
  assert.equal(safeTrelloUrl('javascript:alert(1)'),null);assert.equal(safeTrelloUrl('https://trello.com.evil.org/c/abc'),null);assert.equal(safeTrelloUrl('https://trello.com/c/abc'),'https://trello.com/c/abc');
});
test('deadline label matches its full name and milestone uses the due day',()=>{
  assert.equal(isDeadline({labels:[{name:' Deadline '}]}),true);
  assert.equal(isDeadline({labels:[{name:'DEADLINE'}]}),true);
  assert.equal(isDeadline({labels:[{name:'Deadline later'}]}),false);
  assert.equal(isDeadline({}),false);
  assert.equal(isDeadline({name:'Deadline 1'}),true);
  assert.equal(isDeadline({name:' deadline2: Abgabe'}),true);
  assert.equal(isDeadline({name:'Deadline-Recherche'}),true);
  assert.equal(isDeadline({name:'Neue Deadline recherchieren'}),false);
  assert.equal(isDeadline({name:'Deadlines recherchieren'}),false);
  assert.equal(deadlineDay({start:'2026-10-12',due:'2026-10-19'}),dayNumber('2026-10-19'));
  assert.equal(deadlineDay({}),null);
});
test('aliases use stable member IDs and fall back to Trello names',()=>{
  const member={id:'123',fullName:'nickname',username:'nick'};
  assert.equal(memberDisplayName(member,{'123':'  Florian  '}),'Florian');
  assert.equal(memberDisplayName(member,{'456':'Other'}),'nickname');
  assert.equal(memberDisplayName(member,{'123':' '}),'nickname');
  assert.equal(memberDisplayName({id:'789',username:'nick'}),'nick');
});
test('external labels reserve space and wrapped names determine lane heights',()=>{
  const result=placeEntries([{id:'a',left:0,width:350,height:90},{id:'b',left:52,width:350,height:60},{id:'c',left:358,width:300,height:54}]);
  const byId=Object.fromEntries(result.entries.map(entry=>[entry.id,entry]));
  assert.notEqual(byId.a.lane,byId.b.lane);
  assert.equal(byId.a.lane,byId.c.lane);
  assert.ok(byId.b.top>=byId.a.top+90+8);
});
test('18:00 ends exactly three quarters through its day for cards and milestones',()=>{
  const due='2026-10-19T18:00:00',anchor=dayNumber(due);
  const geometry=cardGeometry({due},anchor,7,80);
  assert.deepEqual(geometry,{left:0,width:60});
  assert.equal(deadlinePosition({due}),anchor+.75);
  assert.ok(Math.abs(timePosition('2026-10-19T18:30:00')-anchor-18.5/24)<1e-9);
  const multi=cardGeometry({start:'2026-10-17T12:00:00',due},anchor-2,7,80);
  assert.equal(multi.width,220);
});
test('calendar days stay equally wide across daylight-saving changes',()=>{
  for(const date of ['2026-03-29','2026-10-25']) {
    const anchor=dayNumber(date+'T00:00:00');
    assert.equal(timePosition(date+'T18:00:00'),anchor+.75);
    assert.equal(cardGeometry({start:date+'T00:00:00',due:date+'T18:00:00'},anchor,2,80).width,60);
  }
});
test('clipping, date-only dates and midnight deadlines keep accurate boundaries',()=>{
  const day=dayNumber('2026-10-19T00:00:00');
  assert.deepEqual(cardGeometry({start:'2026-10-17',due:'2026-10-19T18:00:00'},day,1,80),{left:0,width:60});
  assert.deepEqual(cardGeometry({due:'2026-10-19'},day,1,80),{left:0,width:80});
  assert.equal(cardGeometry({start:'2026-10-17',due:'2026-10-19T00:00:00'},day,1,80),null);
  assert.equal(deadlinePosition({due:'2026-10-19T00:00:00'}),day);
  assert.deepEqual(timedInterval({start:'2026-10-19T00:00:00'}),{start:day,end:day+1});
  assert.equal(cardGeometry({},day,1,80),null);
});
test('minimap clips tasks to its range, separates overlaps and retains hidden-board deadlines',()=>{
  const start=dayNumber('2026-10-19T00:00:00');
  const boards=[{id:'tasks',cards:[
    {id:'a',start:'2026-10-17',due:'2026-10-20T12:00:00'},
    {id:'b',start:'2026-10-19',due:'2026-10-21T18:00:00'},
    {id:'outside',due:'2026-11-01'},
    {id:'empty'},
  ]},{id:'project',cards:[{id:'milestone',name:'Deadline 1',due:'2026-10-20T18:00:00'},{id:'hidden-task',due:'2026-10-20T12:00:00'}]}];
  const result=minimapLayout(boards,{project:true},start,start+2);
  assert.equal(result.blocks.length,2);
  assert.equal(result.blocks[0].left,0);
  assert.equal(result.blocks[0].width,.75);
  assert.equal(result.blocks[1].width,1);
  assert.notEqual(result.blocks[0].lane,result.blocks[1].lane);
  assert.equal(result.deadlines.length,1);
  assert.equal(result.deadlines[0].position,.875);
  const onlyDeadlines=minimapLayout(boards,{project:true,tasks:true},start,start+2);
  assert.equal(onlyDeadlines.blocks.length,0);assert.equal(onlyDeadlines.deadlines.length,1);
  assert.equal(minimapLayout(boards,{},start,start).blocks.length,0);
});
test('blockers ignore hours and include the entire final day across year boundaries',()=>{
  const card={id:'holiday',name:'Weihnachten & Neujahr',labels:[{name:' Blocker '}],start:'2026-12-21T18:00:00',due:'2027-01-03T09:00:00'};
  assert.equal(isBlocker(card),true);
  assert.equal(isBlocker({labels:[{name:'BLOCKER'}]}),true);
  assert.equal(isBlocker({name:'Blocker recherchieren'}),false);
  assert.equal(isBlocker({labels:[{name:'Blocker später'}]}),false);
  const range=blockerInterval(card);
  assert.equal(range.start,dayNumber('2026-12-21T00:00:00'));
  assert.equal(range.end,dayNumber('2027-01-04T00:00:00'));
  assert.equal(range.end-range.start,14);
  const model=minimapLayout([{id:'management',cards:[card]}],{management:true},range.start,range.end);
  assert.equal(model.blocks.length,0);assert.equal(model.blockers.length,1);
  assert.equal(model.blockers[0].left,0);assert.equal(model.blockers[0].width,1);
  const clipped=minimapLayout([{id:'management',cards:[card]}],{},range.start-7,range.start+7);
  assert.equal(clipped.blockers[0].left,.5);assert.equal(clipped.blockers[0].width,.5);
  assert.equal(blockerInterval({due:'2027-01-03T09:00:00'}).end-blockerInterval({due:'2027-01-03T09:00:00'}).start,1);
  assert.equal(blockerInterval({}),null);
  const dual={...card,name:'Deadline 2',labels:[{name:'Deadline'},{name:'Blocker'}]};
  const dualModel=minimapLayout([{id:'management',cards:[dual]}],{},range.start,range.end);
  assert.equal(dualModel.blockers.length,1);assert.equal(dualModel.deadlines.length,0);assert.equal(dualModel.blocks.length,0);
});
test('each deadline retains a date label, including nearby and identical dates',()=>{
  const result=markerLabelLayout([{id:'a',position:0},{id:'b',position:.01},{id:'c',position:.01},{id:'d',position:.5},{id:'e',position:1}],300);
  assert.equal(result.labels.length,5);
  for(const label of result.labels){
    assert.ok(label.left>=0&&label.left+label.width<=300);
    for(const other of result.labels)if(other!==label&&other.lane===label.lane){
      assert.ok(label.left+label.width<=other.left||other.left+other.width<=label.left);
    }
  }
  assert.ok(result.lanes>=3);
  assert.equal(markerLabelLayout([{position:.5}],50).labels[0].width,50);
});
test('sprints are global timed phases, not tasks or blocker shading',()=>{
  const sprint={id:'s',name:'Sprint 1',start:'2026-10-19T12:00:00',due:'2026-11-01T18:00:00',labels:[{name:' SPRINT '}]};
  assert.equal(isSprint(sprint),true);
  const start=dayNumber(sprint.start),model=minimapLayout([{id:'hidden',cards:[sprint]}],{hidden:true},start,start+14);
  assert.equal(model.sprints.length,1);assert.equal(model.sprints[0].width,13.75/14);
  assert.equal(model.blocks.length,0);assert.equal(model.blockers.length,0);assert.equal(model.deadlines.length,0);
  assert.equal(cardKind({...sprint,labels:[{name:'Sprint'},{name:'Deadline'}]}),'sprint');
  assert.equal(cardKind({...sprint,labels:[{name:'Sprint'},{name:'Blocker'}]}),'blocker');
});
test('classification can be configured by label, list, or title prefix and disabled',()=>{
  const rules=defaultClassification();
  rules.deadline={labels:['Milestone'],lists:[],titlePrefixes:['Meeting']};
  rules.blocker={labels:[],lists:['Time off'],titlePrefixes:[]};
  rules.sprint={labels:['Iteration'],lists:[],titlePrefixes:['Phase']};
  assert.equal(cardKind({name:'Meeting 6'},rules),'deadline');
  assert.equal(cardKind({name:'Meetings to research'},rules),'task');
  assert.equal(cardKind({labels:[{name:'MILESTONE'}]},rules),'deadline');
  assert.equal(cardKind({idList:'leave'},rules,[{id:'leave',name:'Time off'}]),'blocker');
  assert.equal(cardKind({name:'Phase 2'},rules),'sprint');
  assert.equal(cardKind({labels:[{name:'Sprint'}]},rules),'task');
  assert.equal(cardKind({labels:[{name:'Iteration'}]},rules),'sprint');
  rules.deadline={labels:[],lists:[],titlePrefixes:[]};
  assert.equal(cardKind({name:'Deadline 1',labels:[{name:'Deadline'}]},rules),'task');
});
test('compact deadline footprints can share a lane while true overlaps still wrap',()=>{
  const compact=placeEntries([{id:'meeting',left:0,width:110,height:27},{id:'submission',left:200,width:120,height:27}]);
  assert.equal(compact.entries[0].lane,compact.entries[1].lane);
  const overlap=placeEntries([{id:'meeting',left:0,width:240,height:27},{id:'submission',left:200,width:120,height:27}]);
  assert.notEqual(overlap.entries[0].lane,overlap.entries[1].lane);
});


test('consecutive timed sprints share a row even at minimap scale; overlapping ones wrap',()=>{
  const sprint=(id,start,due)=>({id,name:id,start,due,labels:[{name:'Sprint'}]});
  const cards=[sprint('one','2026-10-12T00:00:00','2026-11-02T12:00:00'),sprint('two','2026-11-03T00:00:00','2026-11-16T12:00:00')];
  const start=dayNumber('2026-10-12T00:00:00'),end=dayNumber('2027-01-31T00:00:00')+1;
  const model=minimapLayout([{id:'b',cards}],{},start,end);
  const entries=model.sprints.map(item=>({...item,left:item.left*500,width:item.width*500,height:20}));
  assert.equal(model.sprints[0].width,(21.5)/(end-start));
  assert.deepEqual(placeEntries(entries,0).entries.map(item=>item.lane),[0,0]);
  const overlap=minimapLayout([{id:'b',cards:[cards[0],sprint('overlap','2026-11-02T00:00:00','2026-11-16T12:00:00')]}],{},start,end);
  assert.deepEqual(placeEntries(overlap.sprints.map(item=>({...item,left:item.left*500,width:item.width*500,height:20})),0).entries.map(item=>item.lane),[0,1]);
});
