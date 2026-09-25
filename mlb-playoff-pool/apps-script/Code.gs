const PICK_FIELDS = ["alWC1","alWC2","nlWC1","nlWC2","alds1","alds2","nlds1","nlds2","alcs","nlcs","ws"];
const AL_TEAMS = ["TB","CLE","TEX","NYY","BOS","CWS"];
const NL_TEAMS = ["MIL","LAD","ATL","CHC","SD","PHI"];
const TEAM_ABBR_BY_ID = {
  139:"TB",114:"CLE",140:"TEX",147:"NYY",111:"BOS",145:"CWS",
  158:"MIL",119:"LAD",144:"ATL",112:"CHC",135:"SD",143:"PHI"
};
const AL_TEAM_IDS = [139,114,140,147,111,145];
const NL_TEAM_IDS = [158,119,144,112,135,143];

function doGet(e) {
  return json_({ok:true,message:"MLB playoff pool API",status:getStatus_()});
}

function doPost(e) {
  try {
    const raw=(e.postData && e.postData.contents) || "{}";
    if (raw.length > 12000) throw new Error("Request too large");
    const body = JSON.parse(raw);
    const action = body.action;
    if (!action) throw new Error("Missing action");
    const handlers = {
      getStatus: () => ({ok:true,status:getStatus_(),results:getResults_()}),
      submitPick: () => submitPick_(body),
      getPicks: () => getPicks_(body),
      getResults: () => ({ok:true,results:getResults_()}),
      setResults: () => setResults_(body),
      setLock: () => setLock_(body),
      setCommissionerNote: () => setCommissionerNote_(body),
      syncMlbResults: () => syncMlbResults_(body)
    };
    if (!handlers[action]) throw new Error("Unknown action");
    return json_(handlers[action]());
  } catch (err) {
    return json_({ok:false,error:String(err && err.message || err)});
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!id) throw new Error("Missing SHEET_ID script property");
  return SpreadsheetApp.openById(id);
}

function setupPool() {
  const ss = ss_();
  ensureSheet_("Picks", ["name","pinHash"].concat(PICK_FIELDS,["wsGames","wsRuns","wsHRs","submittedAt","lastEditedAt"]));
  ensureSheet_("Results", PICK_FIELDS.concat(["wsGames","wsRuns","wsHRs","updatedAt"]));
  ensureSheet_("Config", ["key","value"]);
  const config = ss.getSheetByName("Config");
  const current = config.getDataRange().getValues().slice(1);
  const keys = new Set(current.map(r=>r[0]));
  if (!keys.has("lockAt")) config.appendRow(["lockAt",""]);
  if (!keys.has("locked")) config.appendRow(["locked",""]);
  if (!keys.has("commissionerNote")) config.appendRow(["commissionerNote",""]);
  return "Pool sheets ready";
}

function ensureSheet_(name, headers) {
  const ss=ss_();
  let sh=ss.getSheetByName(name);
  if (!sh) sh=ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  const current=sh.getRange(1,1,1,headers.length).getValues()[0];
  if (current.join("|") !== headers.join("|")) {
    sh.clear();
    sh.appendRow(headers);
  }
  sh.setFrozenRows(1);
  return sh;
}

function configMap_() {
  const sh=ss_().getSheetByName("Config");
  if (!sh) throw new Error("Run setupPool() first");
  const vals=sh.getDataRange().getValues().slice(1);
  return Object.fromEntries(vals.filter(r=>r[0]).map(r=>[String(r[0]),String(r[1])]));
}

function getStatus_() {
  const c=configMap_();
  const timed = c.lockAt && !isNaN(Date.parse(c.lockAt)) && Date.now() >= Date.parse(c.lockAt);
  const manual = String(c.locked || "").trim().toLowerCase();
  const picks=ss_().getSheetByName("Picks");
  const entryCount=picks ? Math.max(0,picks.getLastRow()-1) : 0;
  return {
    locked: manual==="true" ? true : !!timed,
    lockAt:c.lockAt || null,
    manualLock:manual==="true",
    entryCount:entryCount,
    commissionerNote:String(c.commissionerNote||"").slice(0,160)
  };
}

function requireAdmin_(password) {
  const saved=PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!saved) throw new Error("ADMIN_PASSWORD is not configured");
  if (!password || !safeEqual_(String(password),saved)) throw new Error("Invalid commissioner password");
}

function safeEqual_(a,b) {
  if (a.length !== b.length) return false;
  let out=0;
  for (let i=0;i<a.length;i++) out |= a.charCodeAt(i)^b.charCodeAt(i);
  return out===0;
}

function cleanName_(name) {
  const n=String(name||"").trim().replace(/\s+/g," ");
  if (n.length < 1 || n.length > 40) throw new Error("Name must be 1–40 characters");
  if (/^[=+@-]/.test(n)) throw new Error("Name contains unsupported characters");
  return n;
}

function hashPin_(name,pin) {
  const p=String(pin||"");
  if (p.length < 6 || p.length > 12) throw new Error("PIN must be 6–12 characters");
  const secret=PropertiesService.getScriptProperties().getProperty("PIN_PEPPER");
  if (!secret) throw new Error("PIN_PEPPER is not configured");
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cleanName_(name).toLowerCase()+"|"+p+"|"+secret);
  return bytes.map(b=>(b<0?b+256:b).toString(16).padStart(2,"0")).join("");
}

function validatePicks_(picks) {
  const out={};
  PICK_FIELDS.forEach(f=>{
    const v=String((picks||{})[f]||"").trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(v)) throw new Error("Missing or invalid pick: "+f);
    out[f]=v;
  });
  const allowed = {
    alWC1:["TEX","CWS"], alWC2:["NYY","BOS"],
    nlWC1:["ATL","PHI"], nlWC2:["CHC","SD"]
  };
  Object.keys(allowed).forEach(f=>{
    if (!allowed[f].includes(out[f])) throw new Error("Impossible bracket pick: "+f);
  });
  if (!["TB",out.alWC2].includes(out.alds1)) throw new Error("Impossible bracket pick: alds1");
  if (!["CLE",out.alWC1].includes(out.alds2)) throw new Error("Impossible bracket pick: alds2");
  if (!["MIL",out.nlWC2].includes(out.nlds1)) throw new Error("Impossible bracket pick: nlds1");
  if (!["LAD",out.nlWC1].includes(out.nlds2)) throw new Error("Impossible bracket pick: nlds2");
  if (![out.alds1,out.alds2].includes(out.alcs)) throw new Error("Impossible bracket pick: alcs");
  if (![out.nlds1,out.nlds2].includes(out.nlcs)) throw new Error("Impossible bracket pick: nlcs");
  if (![out.alcs,out.nlcs].includes(out.ws)) throw new Error("Impossible bracket pick: ws");
  const g=Number((picks||{}).wsGames);
  const runs=Number((picks||{}).wsRuns);
  const hrs=Number((picks||{}).wsHRs);
  if (![4,5,6,7].includes(g)) throw new Error("World Series games tiebreaker must be 4–7");
  if (!Number.isInteger(runs) || runs < 1 || runs > 150) throw new Error("World Series runs tiebreaker must be a whole number from 1–150");
  if (!Number.isInteger(hrs) || hrs < 0 || hrs > 80) throw new Error("World Series home runs tiebreaker must be a whole number from 0–80");
  out.wsGames=g;
  out.wsRuns=runs;
  out.wsHRs=hrs;
  return out;
}

function submitPick_(body) {
  const status=getStatus_();
  if (status.locked) requireAdmin_(body.adminPassword);
  const name=cleanName_(body.name);
  const pinHash=hashPin_(name,body.pin);
  const picks=validatePicks_(body.picks);
  const sh=ss_().getSheetByName("Picks");
  if (!sh) throw new Error("Run setupPool() first");
  const scriptLock=LockService.getScriptLock();
  scriptLock.waitLock(5000);
  try {
  const data=sh.getDataRange().getValues();
  const headers=data[0];
  const rows=data.slice(1);
  const idx=rows.findIndex(r=>String(r[0]).trim().toLowerCase()===name.toLowerCase());
  const now=new Date().toISOString();
  let submittedAt=now, updated=false;
  if (idx>=0) {
    if (!safeEqual_(String(rows[idx][1]),pinHash) && !body.adminPassword) throw new Error("That name already exists. Use its edit PIN.");
    if (!safeEqual_(String(rows[idx][1]),pinHash) && body.adminPassword) requireAdmin_(body.adminPassword);
    submittedAt=rows[idx][headers.indexOf("submittedAt")] || now;
    updated=true;
  }
  const obj={name,pinHash,...picks,submittedAt,lastEditedAt:now};
  const row=headers.map(h=>obj[h]??"");
  const target=idx>=0 ? sh.getRange(idx+2,1,1,row.length) : sh.getRange(sh.getLastRow()+1,1,1,row.length);
  target.setNumberFormat("@");
  target.setValues([row]);
  const entryCount=Math.max(0,sh.getLastRow()-1);
  return {ok:true,updated,lastEditedAt:now,entryCount};
  } finally {
    scriptLock.releaseLock();
  }
}

function getPicks_(body) {
  const sh=ss_().getSheetByName("Picks");
  if (!sh) throw new Error("Run setupPool() first");
  const values=sh.getDataRange().getValues();
  const headers=values[0];
  const rows=values.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
  const status=getStatus_();
  if (status.locked) {
    const picks=rows.map(({pinHash,...rest})=>rest);
    return {ok:true,picks,results:getResults_()};
  }
  const name=cleanName_(body.name);
  const match=rows.find(r=>String(r.name).trim().toLowerCase()===name.toLowerCase());
  if (!match) return {ok:true,pick:null};
  if (!safeEqual_(String(match.pinHash),hashPin_(name,body.pin))) throw new Error("Incorrect edit PIN");
  const {pinHash,...pick}=match;
  return {ok:true,pick};
}

function getResults_() {
  const sh=ss_().getSheetByName("Results");
  if (!sh || sh.getLastRow()<2) return {};
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const row=sh.getRange(2,1,1,headers.length).getValues()[0];
  return Object.fromEntries(headers.map((h,i)=>[h,row[i]]).filter(([,v])=>v!=="" && v!=null));
}

function setResults_(body) {
  requireAdmin_(body.adminPassword);
  const sh=ss_().getSheetByName("Results");
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const current=getResults_();
  const incoming=body.results||{};
  const result={...current};
  PICK_FIELDS.forEach(f=>{
    const v=String(incoming[f]||"").trim().toUpperCase();
    if (v) result[f]=v; else delete result[f];
  });
  if (incoming.wsGames && [4,5,6,7].includes(Number(incoming.wsGames))) result.wsGames=Number(incoming.wsGames); else delete result.wsGames;
  if (incoming.wsRuns !== "" && incoming.wsRuns != null && Number.isFinite(Number(incoming.wsRuns))) result.wsRuns=Number(incoming.wsRuns); else delete result.wsRuns;
  if (incoming.wsHRs !== "" && incoming.wsHRs != null && Number.isFinite(Number(incoming.wsHRs))) result.wsHRs=Number(incoming.wsHRs); else delete result.wsHRs;
  result.updatedAt=new Date().toISOString();
  const row=headers.map(h=>result[h]??"");
  if (sh.getLastRow()<2) sh.appendRow(row); else sh.getRange(2,1,1,row.length).setValues([row]);
  return {ok:true,results:result};
}

function setLock_(body) {
  requireAdmin_(body.adminPassword);
  const sh=ss_().getSheetByName("Config");
  const data=sh.getDataRange().getValues();
  const idx=data.findIndex((r,i)=>i>0 && r[0]==="locked");
  const value=body.locked===true ? "true" : "";
  if (idx<0) sh.appendRow(["locked",value]); else sh.getRange(idx+1,2).setValue(value);
  return {ok:true,status:getStatus_()};
}
function setCommissionerNote_(body) {
  requireAdmin_(body.adminPassword);
  const note=String(body.note||"").trim().slice(0,160);
  const sh=ss_().getSheetByName("Config");
  const data=sh.getDataRange().getValues();
  const idx=data.findIndex((r,i)=>i>0 && r[0]==="commissionerNote");
  if (idx<0) sh.appendRow(["commissionerNote",note]);
  else sh.getRange(idx+1,2).setValue(note);
  return {ok:true,note};
}

function syncMlbResults_(body) {
  const props=PropertiesService.getScriptProperties();
  const hasAdmin=body && body.adminPassword;
  if (hasAdmin) requireAdmin_(body.adminPassword);
  const last=Number(props.getProperty("MLB_LAST_SYNC_MS")||0);
  if (!hasAdmin && last && Date.now()-last < 15*60*1000) {
    return {ok:true,results:getResults_(),syncedAt:new Date(last).toISOString(),cached:true};
  }
  const url="https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026&gameTypes=F,D,L,W&hydrate=linescore";
  const resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true});
  if (resp.getResponseCode() !== 200) throw new Error("MLB schedule request failed");
  const payload=JSON.parse(resp.getContentText());
  const games=(payload.dates||[]).reduce((all,d)=>all.concat(d.games||[]),[]);
  const completed=games.filter(g=>g.status && g.status.abstractGameState==="Final");
  const groups={};
  completed.forEach(g=>{
    const aId=Number(g.teams.away.team.id);
    const hId=Number(g.teams.home.team.id);
    const key=[aId,hId].sort((x,y)=>x-y).join("|")+"|"+g.gameType;
    if(!groups[key]) groups[key]={gameType:g.gameType,teamIds:[aId,hId],wins:{},games:[]};
    const winnerId=g.teams.away.isWinner?aId:(g.teams.home.isWinner?hId:null);
    if(winnerId) groups[key].wins[winnerId]=(groups[key].wins[winnerId]||0)+1;
    groups[key].games.push(g);
  });
  const result=getResults_();
  Object.keys(groups).forEach(key=>{
    const s=groups[key], need=s.gameType==="F"?2:(s.gameType==="D"?3:4);
    const winnerId=Number(Object.keys(s.wins).find(t=>s.wins[t]>=need));
    if(!winnerId) return;
    const winner=TEAM_ABBR_BY_ID[winnerId];
    if(!winner) return;
    const teams=s.teamIds;
    if(s.gameType==="F"){
      if(teams.includes(140)||teams.includes(145)) result.alWC1=winner;
      else if(teams.includes(147)||teams.includes(111)) result.alWC2=winner;
      else if(teams.includes(144)||teams.includes(143)) result.nlWC1=winner;
      else if(teams.includes(112)||teams.includes(135)) result.nlWC2=winner;
    } else if(s.gameType==="D"){
      if(teams.includes(139)) result.alds1=winner;
      else if(teams.includes(114)) result.alds2=winner;
      else if(teams.includes(158)) result.nlds1=winner;
      else if(teams.includes(119)) result.nlds2=winner;
    } else if(s.gameType==="L"){
      if(teams.some(t=>AL_TEAM_IDS.includes(t))) result.alcs=winner;
      else if(teams.some(t=>NL_TEAM_IDS.includes(t))) result.nlcs=winner;
    } else if(s.gameType==="W") result.ws=winner;
  });
  const wsGames=completed.filter(g=>g.gameType==="W");
  if(wsGames.length){
    result.wsGames=wsGames.length;
    result.wsRuns=wsGames.reduce((sum,g)=>sum+Number(g.teams.away.score||0)+Number(g.teams.home.score||0),0);
    let hrs=0;
    wsGames.forEach(g=>{
      try{
        const b=JSON.parse(UrlFetchApp.fetch("https://statsapi.mlb.com/api/v1/game/"+g.gamePk+"/boxscore").getContentText());
        hrs += Number(b.teams.away.teamStats.batting.homeRuns||0)+Number(b.teams.home.teamStats.batting.homeRuns||0);
      }catch(err){}
    });
    result.wsHRs=hrs;
  }
  result.updatedAt=new Date().toISOString();
  props.setProperty("MLB_LAST_SYNC_MS",String(Date.now()));
  const sh=ss_().getSheetByName("Results");
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const row=headers.map(h=>result[h]??"");
  if(sh.getLastRow()<2) sh.appendRow(row); else sh.getRange(2,1,1,row.length).setValues([row]);
  return {ok:true,results:result,syncedAt:result.updatedAt,completedGames:completed.length};
}
