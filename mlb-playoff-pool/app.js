(() => {
  const cfg = window.POOL_CONFIG;
  const FIELDS = ["alWC1","alWC2","nlWC1","nlWC2","alds1","alds2","nlds1","nlds2","alcs","nlcs","ws"];
  const LABELS = {
    alWC1:"AL WC: 3 vs 6", alWC2:"AL WC: 4 vs 5", nlWC1:"NL WC: 3 vs 6", nlWC2:"NL WC: 4 vs 5",
    alds1:"ALDS: 1 vs WC", alds2:"ALDS: 2 vs WC", nlds1:"NLDS: 1 vs WC", nlds2:"NLDS: 2 vs WC",
    alcs:"ALCS", nlcs:"NLCS", ws:"World Series"
  };
  const state = { picks:{}, status:{locked:false,lockAt:null,entryCount:0,commissionerNote:""}, results:{}, allPicks:[], identity:{name:"",pin:""} };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const teamMap = Object.fromEntries([...cfg.TEAMS.AL,...cfg.TEAMS.NL].map(t=>[t.abbr,t]));

  function api(action, data={}) {
    if (!cfg.API_URL) return Promise.reject(new Error("API URL not configured"));
    return fetch(cfg.API_URL, {
      method:"POST",
      headers:{"Content-Type":"text/plain;charset=utf-8"},
      body:JSON.stringify({action,...data})
    }).then(async r => {
      const text = await r.text();
      let json; try { json=JSON.parse(text); } catch { throw new Error("Backend returned an invalid response"); }
      if (!json.ok) throw new Error(json.error || "Request failed");
      return json;
    });
  }

  function rounds() {
    const AL=cfg.TEAMS.AL, NL=cfg.TEAMS.NL;
    const bySeed=(arr,n)=>arr.find(t=>t.seed===n);
    const pickTeam=f=>teamMap[state.picks[f]];
    return [
      {title:"Wild Card", games:[
        ["alWC1",[bySeed(AL,3),bySeed(AL,6)]],["alWC2",[bySeed(AL,4),bySeed(AL,5)]],
        ["nlWC1",[bySeed(NL,3),bySeed(NL,6)]],["nlWC2",[bySeed(NL,4),bySeed(NL,5)]]
      ]},
      {title:"Division Series", games:[
        ["alds1",[bySeed(AL,1),pickTeam("alWC2")]],["alds2",[bySeed(AL,2),pickTeam("alWC1")]],
        ["nlds1",[bySeed(NL,1),pickTeam("nlWC2")]],["nlds2",[bySeed(NL,2),pickTeam("nlWC1")]]
      ]},
      {title:"League Championship", games:[
        ["alcs",[pickTeam("alds1"),pickTeam("alds2")]],["nlcs",[pickTeam("nlds1"),pickTeam("nlds2")]]
      ]},
      {title:"World Series", games:[["ws",[pickTeam("alcs"),pickTeam("nlcs")]]]}
    ];
  }

  function invalidateAfter(field) {
    const deps = {
      alWC1:["alds2","alcs","ws"], alWC2:["alds1","alcs","ws"], nlWC1:["nlds2","nlcs","ws"], nlWC2:["nlds1","nlcs","ws"],
      alds1:["alcs","ws"],alds2:["alcs","ws"],nlds1:["nlcs","ws"],nlds2:["nlcs","ws"],alcs:["ws"],nlcs:["ws"]
    };
    for (const f of deps[field]||[]) delete state.picks[f];
  }

  function renderBracket() {
    $("#bracket").innerHTML = rounds().map(r=>`
      <div class="round"><div class="round-title"><span>${r.title}</span></div><div class="round-games">
      ${r.games.map(([field,teams])=>`
        <div class="matchup ${state.picks[field] ? "matchup-picked" : ""}">
          <div class="matchup-label">${LABELS[field]}</div>
          ${teams.map(t => t ? `<button class="team-btn ${state.picks[field]===t.abbr?"selected":""}" data-field="${field}" data-team="${t.abbr}" ${state.status.locked?"disabled":""}>
            <span class="seed">${t.seed}</span><span>${esc(t.name)}</span>
          </button>` : `<button class="team-btn disabled" disabled><span class="seed">—</span><span>Make earlier pick</span></button>`).join("")}
        </div>`).join("")}</div></div>`).join("");
    document.querySelectorAll(".team-btn[data-team]").forEach(b=>b.addEventListener("click",()=>{
      const f=b.dataset.field; const v=b.dataset.team;
      if(state.picks[f]!==v) invalidateAfter(f);
      state.picks[f]=v; renderBracket();
    }));
  }

  function autoPick(mode) {
    state.picks={};
    const choose = teams => mode==="chalk" ? teams.slice().sort((a,b)=>a.seed-b.seed)[0] : teams[Math.floor(Math.random()*teams.length)];
    for (let roundIndex=0; roundIndex<4; roundIndex++) {
      const current=rounds()[roundIndex];
      for (const [field,teams] of current.games) {
        const valid=teams.filter(Boolean);
        if(valid.length===2) state.picks[field]=choose(valid).abbr;
      }
    }
    renderBracket();
  }

  function renderResultsEditor() {
    if (!$("#resultsEditor")) return;
    $("#resultsEditor").innerHTML = FIELDS.map(f=>`
      <div class="result-row"><label for="res-${f}">${LABELS[f]}</label>
      <select id="res-${f}"><option value="">Not decided</option>${Object.values(teamMap).map(t=>`<option value="${t.abbr}" ${state.results[f]===t.abbr?"selected":""}>${t.name}</option>`).join("")}</select></div>`).join("") + `
      <div class="result-row"><label for="res-wsGames">World Series games</label>
      <select id="res-wsGames"><option value="">Not final</option>${[4,5,6,7].map(n=>`<option value="${n}" ${Number(state.results.wsGames)===n?"selected":""}>${n} games</option>`).join("")}</select></div>`;
  }

  function updateStatusUI() {
    const locked=state.status.locked;
    const count=Number(state.status.entryCount)||0;
    $("#entryCount").textContent=`${count} bracket${count===1?"":"s"} entered`;
    const note=String(state.status.commissionerNote||"").trim();
    $("#commissionerNote").textContent=note;
    $("#commissionerNote").classList.toggle("hidden",!note);
    if ($("#commissionerNoteInput")) $("#commissionerNoteInput").value=note;
    $("#lockDot").className="status-dot "+(locked?"locked":"live");
    $("#lockLabel").textContent=locked?"Picks locked":"Picks open";
    $("#submitBtn").textContent=locked?"Picks are locked":"Submit bracket";
    $("#submitBtn").disabled=locked;
    $("#overrideWrap").classList.add("hidden");
    if(state.status.lockAt){
      const target=new Date(state.status.lockAt);
      const update=()=>{
        const d=target-Date.now();
        $("#countdown").textContent=d<=0?"Deadline reached":`Locks in ${Math.floor(d/86400000)}d ${Math.floor(d%86400000/3600000)}h ${Math.floor(d%3600000/60000)}m`;
      }; update(); setInterval(update,60000);
    } else $("#countdown").textContent=locked?"Pool locked":"Deadline not set";
  }

  async function refreshStatus() {
    renderBracket();
    renderResultsEditor();
    updateStatusUI();
    if(!cfg.API_URL){
      $("#setupBanner").classList.remove("hidden");
      $("#setupBanner").textContent="Pool backend is not connected yet.";
      return;
    }
    try {
      const r=await api("getStatus");
      state.status=r.status;
      state.results=r.results||{};
      $("#setupBanner").classList.add("hidden");
      updateStatusUI();
      renderBracket();
      renderResultsEditor();
    } catch(e){
      $("#setupBanner").classList.remove("hidden");
      $("#setupBanner").textContent="Can't reach the pool backend. If Apps Script is restricted to your Google domain, change the web app access to Anyone so this GitHub Pages site can connect.";
      $("#lockLabel").textContent="Backend unavailable";
      $("#countdown").textContent="Deadline unavailable";
    }
  }

  function scorePick(p) {
    let score=0; for(const f of FIELDS) if(state.results[f] && p[f]===state.results[f]) score++;
    return score;
  }

  function renderDashboard() {
    const locked=state.status.locked;
    $("#dashboardLocked").classList.toggle("hidden",locked);
    $("#dashboardContent").classList.toggle("hidden",!locked);
    if(!locked)return;
    const tiebreaks={
      wsGames:Number(state.results.wsGames)||null,
      wsRuns:Number(state.results.wsRuns)||null,
      wsHRs:Number(state.results.wsHRs)||null
    };
    const distance=(p,key)=>tiebreaks[key]===null?0:Math.abs(Number(p[key])-tiebreaks[key]);
    const rows=state.allPicks.map(p=>({...p,score:scorePick(p)})).sort((a,b)=>
      b.score-a.score ||
      distance(a,"wsGames")-distance(b,"wsGames") ||
      distance(a,"wsRuns")-distance(b,"wsRuns") ||
      distance(a,"wsHRs")-distance(b,"wsHRs") ||
      new Date(a.submittedAt)-new Date(b.submittedAt)
    );
    const decided=FIELDS.filter(f=>state.results[f]).length;
    $("#leaderboard").innerHTML=rows.map((p,i)=>{
      const maxPossible=p.score+(11-decided);
      const leaderScore=rows[0]?.score||0;
      const eliminated=maxPossible<leaderScore;
      return `<div class="leader-row"><span class="rank">${i+1}</span><span><strong>${esc(p.name)}</strong><small>${eliminated?"Eliminated":`Max ${maxPossible}`}</small></span><span class="score">${p.score}/11</span></div>`;
    }).join("") || "<p class='subtle'>No entries yet.</p>";
    $("#popularity").innerHTML=FIELDS.map(f=>{
      const counts={}; rows.forEach(p=>{if(p[f])counts[p[f]]=(counts[p[f]]||0)+1});
      const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]; if(!top)return "";
      const pct=Math.round(top[1]/rows.length*100); return `<div class="pop-card"><strong>${LABELS[f]}</strong><div>${esc(teamMap[top[0]]?.name||top[0])} · ${pct}%</div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }).join("");
  }

  async function loadGames(){
    const start=new Date(); const end=new Date(Date.now()+5*86400000);
    const fmt=d=>d.toISOString().slice(0,10);
    try{
      const r=await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&hydrate=probablePitcher,team&startDate=${fmt(start)}&endDate=${fmt(end)}`).then(x=>x.json());
      const games=(r.dates||[]).flatMap(d=>d.games||[]).slice(0,10);
      $("#games").innerHTML=games.map(g=>{
        const a=g.teams.away.team.name,h=g.teams.home.team.name;
        const ap=g.teams.away.probablePitcher?.fullName||"TBD", hp=g.teams.home.probablePitcher?.fullName||"TBD";
        return `<div class="game"><div class="game-top"><span>${esc(a)} @ ${esc(h)}</span><span>${new Date(g.gameDate).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span></div><div class="game-meta">${esc(ap)} vs ${esc(hp)} · ${esc(g.status.detailedState)}</div></div>`;
      }).join("")||"<p class='subtle'>No games found in the next five days.</p>";
    }catch{$("#games").innerHTML="<p class='subtle'>MLB schedule is temporarily unavailable.</p>"}
  }

  async function refreshDashboard(){
    if(!state.status.locked){renderDashboard();return}
    try{
      try{
        const sync=await api("syncMlbResults",{});
        state.results=sync.results||state.results;
      }catch(e){}
      const r=await api("getPicks",{name:""});
      state.allPicks=r.picks||[];
      state.results=r.results||state.results;
      renderDashboard();
      loadGames();
    }catch(e){
      $("#dashboardLocked").textContent=e.message;
      $("#dashboardLocked").classList.remove("hidden");
    }
  }

  document.querySelectorAll(".tab[data-view]").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll(".tab[data-view]").forEach(x=>x.classList.toggle("active",x===b));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    $("#"+b.dataset.view+"View").classList.add("active");
    if(b.dataset.view==="dashboard")refreshDashboard();
  }));
  $("#chalkBtn").onclick=()=>autoPick("chalk"); $("#randomBtn").onclick=()=>autoPick("random");
  $("#clearBtn").onclick=()=>{state.picks={};$("#wsGames").value="";$("#wsRuns").value="";$("#wsHRs").value="";renderBracket()};
  $("#loadMineBtn").onclick=async()=>{
    const name=$("#nameInput").value.trim(), pin=$("#pinInput").value;
    if(name) state.identity.name=name;
    if(pin) state.identity.pin=pin;
    try{
      const r=await api("getPicks",{name:state.identity.name,pin:state.identity.pin});
      state.picks=r.pick||{};
      $("#nameInput").value=state.identity.name;
      $("#pinInput").value=state.identity.pin;
      $("#wsGames").value=r.pick?.wsGames||"";
      $("#wsRuns").value=r.pick?.wsRuns||"";
      $("#wsHRs").value=r.pick?.wsHRs||"";
      renderBracket();
      $("#submitMessage").textContent=r.pick?"Saved bracket loaded.":"No saved bracket found.";
      $("#submitMessage").className="form-message";
    }catch(e){
      $("#submitMessage").textContent=e.message;
      $("#submitMessage").className="form-message error";
    }
  };
  $("#submitBtn").onclick=async()=>{
    const visibleName=$("#nameInput").value.trim();
    const visiblePin=$("#pinInput").value;
    if(visibleName) state.identity.name=visibleName;
    if(visiblePin) state.identity.pin=visiblePin;
    const name=visibleName||state.identity.name;
    const pin=visiblePin||state.identity.pin;
    const wsGames=$("#wsGames").value,wsRuns=$("#wsRuns").value,wsHRs=$("#wsHRs").value;
    const missing=FIELDS.filter(f=>!state.picks[f]);
    if(!name||pin.length<6||missing.length||!wsGames||wsRuns===""||wsHRs===""){
      $("#submitMessage").textContent="Add your name, a 6+ character PIN, every series pick, and all three World Series tiebreaker guesses.";
      $("#submitMessage").className="form-message error";
      return;
    }
    $("#nameInput").value=name;
    $("#pinInput").value=pin;
    try{
      const r=await api("submitPick",{name,pin,picks:{...state.picks,wsGames,wsRuns,wsHRs},adminPassword:$("#overridePassword").value});
      state.identity={name,pin};
      $("#nameInput").value=name;
      $("#pinInput").value=pin;
      const when=new Date(r.lastEditedAt||Date.now()).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
      $("#submitMessage").textContent=r.updated?"Bracket updated.":"Bracket submitted.";
      $("#submitMessage").className="form-message success";
      $("#submissionReceipt").textContent=`Locked in, ${name} · ${when} · You can keep editing until the pool locks.`;
      $("#submissionReceipt").classList.remove("hidden");
      if(typeof r.entryCount==="number"){state.status.entryCount=r.entryCount;updateStatusUI();}
    }catch(e){
      $("#submitMessage").textContent=e.message;
      $("#submitMessage").className="form-message error";
    }
  };
  $("#nameInput").addEventListener("input",e=>state.identity.name=e.target.value.trim());
  $("#pinInput").addEventListener("input",e=>state.identity.pin=e.target.value);
  $("#rulesBtn").onclick=()=>$("#rulesPanel").classList.toggle("hidden");
  $("#refreshDashboardBtn").onclick=refreshDashboard;
  if(window.SCORPY_MLB_ASSETS?.length) {
    const asset=window.SCORPY_MLB_ASSETS[0].src;
    const hero=$("#heroScorpy");
    const dash=$("#dashboardScorpy");
    if(hero) hero.src=asset;
    if(dash) dash.src=asset;
  }
  renderBracket();
  renderResultsEditor();
  updateStatusUI();
  refreshStatus();
})();