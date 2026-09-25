const PICK_FIELDS = ["alWC1","alWC2","nlWC1","nlWC2","alds1","alds2","nlds1","nlds2","alcs","nlcs","ws"];

function doGet(e) {
  return json_({ok:true,message:"MLB playoff pool API",status:getStatus_()});
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    const action = body.action;
    if (!action) throw new Error("Missing action");
    const handlers = {
      getStatus: () => ({ok:true,status:getStatus_(),results:getResults_()}),
      submitPick: () => submitPick_(body),
      getPicks: () => getPicks_(body),
      getResults: () => ({ok:true,results:getResults_()}),
      setResults: () => setResults_(body),
      setLock: () => setLock_(body)
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
  ensureSheet_("Picks", ["name","pinHash"].concat(PICK_FIELDS,["wsGames","submittedAt","lastEditedAt"]));
  ensureSheet_("Results", PICK_FIELDS.concat(["wsGames","updatedAt"]));
  ensureSheet_("Config", ["key","value"]);
  const config = ss.getSheetByName("Config");
  const current = config.getDataRange().getValues().slice(1);
  const keys = new Set(current.map(r=>r[0]));
  if (!keys.has("lockAt")) config.appendRow(["lockAt",""]);
  if (!keys.has("locked")) config.appendRow(["locked",""]);
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
  return {locked: manual==="true" ? true : !!timed, lockAt:c.lockAt || null, manualLock:manual==="true"};
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
  if (n.length < 1 || n.length > 40) throw new Error("Name must be 1–40 characters");\n  if (/^[=+@-]/.test(n)) throw new Error("Name contains unsupported characters");
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
  const g=Number((picks||{}).wsGames);
  if (![4,5,6,7].includes(g)) throw new Error("World Series tiebreaker must be 4–7");
  out.wsGames=g;
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
  if (idx>=0) sh.getRange(idx+2,1,1,row.length).setValues([row]);
  else sh.appendRow(row);
  return {ok:true,updated};
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
  if (incoming.wsGames && [4,5,6,7].includes(Number(incoming.wsGames))) result.wsGames=Number(incoming.wsGames);
  else delete result.wsGames;
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