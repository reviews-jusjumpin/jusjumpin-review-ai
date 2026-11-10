/* Negative Review Report — weekly / monthly / custom range, by AI category, vs previous period. */
(function () {
  const TODAY = document.body.dataset.today; // IST date from the server
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ── IST calendar maths on YYYY-MM-DD strings (UTC arithmetic, no local-timezone drift) ──
  const D = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const S = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => S(D(s) + n * 864e5);
  const dow = (s) => (new Date(D(s)).getUTCDay() + 6) % 7; // Monday = 0
  const firstOfMonth = (s) => s.slice(0, 8) + "01";
  const pad = (n) => String(n).padStart(2, "0");

  function periodsFor(p, cf, ct) {
    if (p === "lastweek") {
      const mon = addDays(TODAY, -dow(TODAY) - 7);
      return { from: mon, to: addDays(mon, 6), pfrom: addDays(mon, -7), pto: addDays(mon, -1), name: "Last week", vs: "the week before" };
    }
    if (p === "thisweek") {
      const mon = addDays(TODAY, -dow(TODAY));
      return { from: mon, to: TODAY, pfrom: addDays(mon, -7), pto: addDays(mon, dow(TODAY) - 7), name: "This week so far", vs: "the same days last week" };
    }
    if (p === "lastmonth") {
      const lmEnd = addDays(firstOfMonth(TODAY), -1);
      const lmStart = firstOfMonth(lmEnd);
      const pmEnd = addDays(lmStart, -1);
      return { from: lmStart, to: lmEnd, pfrom: firstOfMonth(pmEnd), pto: pmEnd, name: "Last month", vs: "the month before" };
    }
    if (p === "thismonth") {
      const first = firstOfMonth(TODAY);
      const lmEnd = addDays(first, -1);
      const lmStart = firstOfMonth(lmEnd);
      const day = Math.min(+TODAY.slice(8), +lmEnd.slice(8));
      return { from: first, to: TODAY, pfrom: lmStart, pto: lmStart.slice(0, 8) + pad(day), name: "This month so far", vs: "the same days last month" };
    }
    const len = Math.round((D(ct) - D(cf)) / 864e5) + 1;
    return { from: cf, to: ct, pfrom: addDays(cf, -len), pto: addDays(cf, -1), name: "Custom range", vs: `the ${len} day${len > 1 ? "s" : ""} before` };
  }

  function fmtRange(a, b) {
    const [ya, ma, da] = [+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8)];
    const [yb, mb, db] = [+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)];
    if (a === b) return `${da} ${MONTHS[ma]} ${ya}`;
    if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[mb]} ${yb}`;
    if (ya === yb) return `${da} ${MONTHS[ma]} – ${db} ${MONTHS[mb]} ${yb}`;
    return `${da} ${MONTHS[ma]} ${ya} – ${db} ${MONTHS[mb]} ${yb}`;
  }
  const fmtDay = (d) => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
  function istTime(iso) {
    const t = new Date(Date.parse(iso) + 5.5 * 36e5);
    let h = t.getUTCHours();
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${pad(t.getUTCMinutes())} ${ap}`;
  }

  // ── State ──
  const params = new URLSearchParams(location.search);
  const state = {
    p: ["lastweek", "thisweek", "lastmonth", "thismonth", "custom"].includes(params.get("p")) ? params.get("p") : "lastweek",
    cf: params.get("from") || addDays(TODAY, -7),
    ct: params.get("to") || addDays(TODAY, -1),
    cat: params.get("cat") || "all",
    data: null,
    per: null,
  };
  const responseCache = new Map();

  function syncUrl() {
    const q = new URLSearchParams({ p: state.p });
    if (state.p === "custom") { q.set("from", state.cf); q.set("to", state.ct); }
    if (state.cat !== "all") q.set("cat", state.cat);
    history.replaceState(null, "", `${location.pathname}?${q}`);
  }

  // ── Load ──
  async function load() {
    if (state.p === "custom") {
      if (!state.cf || !state.ct || state.cf > state.ct) return showError("Pick a start date on or before the end date.");
      if (state.ct > TODAY) return showError("The end date can't be in the future.");
    }
    const per = periodsFor(state.p, state.cf, state.ct);
    state.per = per;
    syncUrl();
    document.querySelectorAll(".chip[data-p]").forEach((b) => b.classList.toggle("on", b.dataset.p === state.p));
    $("custom").hidden = state.p !== "custom";
    $("periodLine").innerHTML = `<b>${esc(fmtRange(per.from, per.to))}</b> compared with ${esc(per.vs)} (${esc(fmtRange(per.pfrom, per.pto))})`;

    const key = `${per.from}|${per.to}|${per.pfrom}|${per.pto}`;
    if (responseCache.has(key)) { state.data = responseCache.get(key); return render(); }
    $("out").hidden = true;
    $("err").hidden = true;
    $("loading").hidden = false;
    try {
      const res = await fetch(`/api/review-report?from=${per.from}&to=${per.to}&pfrom=${per.pfrom}&pto=${per.pto}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (!json.failedStores.length) responseCache.set(key, json); // partial results: refetch next time
      if (key !== `${state.per.from}|${state.per.to}|${state.per.pfrom}|${state.per.pto}`) return; // a newer request superseded this one
      state.data = json;
      render();
    } catch (e) {
      showError(`Could not load the report: ${e.message}`);
    } finally {
      $("loading").hidden = true;
    }
  }

  function showError(msg) {
    $("loading").hidden = true;
    $("out").hidden = true;
    $("err").hidden = false;
    $("err").textContent = msg;
  }

  // ── Maths ──
  const label = (t) => (state.data.labels[t] || t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
  const inCat = (r) => state.cat === "all" || r.topics.includes(state.cat);

  function change(c, p) {
    const d = c - p;
    if (d === 0) return { html: `<span class="same">no change</span>`, text: "no change", d };
    const pct = p ? ` (${d > 0 ? "+" : ""}${Math.round((d / p) * 100)}%)` : "";
    if (d > 0) return { html: `<span class="up">▲ +${d}${pct}</span>`, text: `▲ +${d}${pct}`, d };
    return { html: `<span class="down">▼ ${d}${pct}</span>`, text: `▼ ${d}${pct}`, d };
  }

  function computed() {
    const cur = state.data.reviews.filter((r) => r.period === "cur");
    const prev = state.data.reviews.filter((r) => r.period === "prev");
    const cats = new Map();
    for (const [list, k] of [[cur, "c"], [prev, "p"]]) {
      for (const r of list) for (const t of r.topics) {
        const row = cats.get(t) || { t, c: 0, p: 0 };
        row[k]++;
        cats.set(t, row);
      }
    }
    if (state.cat !== "all" && !cats.has(state.cat)) cats.set(state.cat, { t: state.cat, c: 0, p: 0 });
    const catRows = [...cats.values()].sort((a, b) => b.c - a.c || b.p - a.p);

    const curSel = cur.filter(inCat);
    const prevSel = prev.filter(inCat);
    const stores = new Map();
    for (const [list, k] of [[curSel, "c"], [prevSel, "p"]]) {
      for (const r of list) {
        const row = stores.get(r.store) || { store: r.store, c: 0, p: 0, topics: {} };
        row[k]++;
        if (k === "c") for (const t of r.topics) row.topics[t] = (row.topics[t] || 0) + 1;
        stores.set(r.store, row);
      }
    }
    const storeRows = [...stores.values()].sort((a, b) => b.c - a.c || b.c - b.p - (a.c - a.p) || a.store.localeCompare(b.store));
    return { cur, prev, catRows, curSel, prevSel, storeRows };
  }

  const mainIssues = (row) => Object.entries(row.topics)
    .sort((a, b) => b[1] - a[1])
    .filter(([t]) => !["other", "uncategorised"].includes(t))
    .slice(0, 2)
    .map(([t, n]) => `${label(t)} ${n}`)
    .join(", ");

  // ── Render ──
  function render() {
    const d = state.data;
    const m = computed();
    const catName = state.cat === "all" ? "All categories" : label(state.cat);

    // category dropdown
    const opts = ['<option value="all">All categories</option>']
      .concat(m.catRows.map((r) => `<option value="${esc(r.t)}"${r.t === state.cat ? " selected" : ""}>${esc(label(r.t))} (${r.c})</option>`));
    $("cat").innerHTML = opts.join("");
    $("cat").value = state.cat;

    const total = change(m.cur.length, m.prev.length);
    const sel = change(m.curSel.length, m.prevSel.length);
    const storesHit = new Set(m.curSel.map((r) => r.store)).size;
    const awaiting = m.curSel.filter((r) => !r.replied).length;
    $("kpis").innerHTML = `
      <div class="card"><div class="lbl">Negative reviews</div><div class="val">${m.cur.length}</div><div class="chg">${total.html}<span class="vs">vs ${m.prev.length}</span></div></div>
      <div class="card"><div class="lbl">${esc(state.cat === "all" ? "Top category" : catName)}</div>${state.cat === "all"
        ? `<div class="val sm">${esc(m.catRows.find((r) => !["other", "uncategorised"].includes(r.t)) ? label(m.catRows.find((r) => !["other", "uncategorised"].includes(r.t)).t) : "—")}</div><div class="chg"><span class="vs">${m.catRows.find((r) => !["other", "uncategorised"].includes(r.t))?.c ?? 0} reviews</span></div>`
        : `<div class="val">${m.curSel.length}</div><div class="chg">${sel.html}<span class="vs">vs ${m.prevSel.length}</span></div>`}</div>
      <div class="card"><div class="lbl">Stores affected</div><div class="val">${storesHit}</div><div class="chg"><span class="vs">of ${d.storeCount}</span></div></div>
      <div class="card"><div class="lbl">Awaiting reply</div><div class="val ${awaiting ? "warn" : ""}">${awaiting}</div><div class="chg"><span class="vs">${esc(state.cat === "all" ? "all categories" : catName)}</span></div></div>`;

    $("failed").hidden = !d.failedStores.length;
    $("failed").textContent = d.failedStores.length ? `⚠️ Could not check: ${d.failedStores.join(", ")} — reload to retry.` : "";

    // category table
    $("catTable").innerHTML = `<tr><th>Category</th><th class="n">This period</th><th class="n">Previous</th><th>Change</th><th class="n">Share</th></tr>` +
      (m.catRows.length ? m.catRows.map((r) => `<tr class="pick${r.t === state.cat ? " sel" : ""}" data-cat="${esc(r.t)}">
        <td>${esc(label(r.t))}</td><td class="n"><b>${r.c}</b></td><td class="n muted">${r.p}</td><td>${change(r.c, r.p).html}</td>
        <td class="n muted">${m.cur.length ? Math.round((r.c / m.cur.length) * 100) : 0}%</td></tr>`).join("")
        : `<tr><td colspan="5" class="muted">No negative reviews in either period.</td></tr>`);

    // store table
    $("storeTitle").textContent = `Stores — ${catName}`;
    $("storeTable").innerHTML = `<tr><th>Store</th><th class="n">This period</th><th class="n">Previous</th><th>Change</th>${state.cat === "all" ? "<th>Main issues</th>" : ""}</tr>` +
      (m.storeRows.length ? m.storeRows.map((r) => `<tr><td><b>${esc(r.store)}</b></td><td class="n"><b>${r.c}</b></td><td class="n muted">${r.p}</td><td>${change(r.c, r.p).html}</td>${state.cat === "all" ? `<td class="muted">${esc(mainIssues(r) || "—")}</td>` : ""}</tr>`).join("")
        : `<tr><td colspan="5" class="muted">No store had a ${esc(catName.toLowerCase())} complaint in either period.</td></tr>`);

    // review list
    $("listTitle").textContent = `Reviews — ${catName} (${m.curSel.length})`;
    $("list").innerHTML = m.curSel.length ? m.curSel.map((r) => `<div class="rev">
      <div class="rev-top"><span class="store">${esc(r.store)}</span><span class="stars">${"★".repeat(r.rating)}<span class="off">${"★".repeat(5 - r.rating)}</span></span><span class="muted">${esc(fmtDay(r.day))}, ${esc(istTime(r.createTime))} · ${esc(r.reviewer)}</span></div>
      ${r.text ? `<div class="txt">${esc(r.text)}</div>` : `<div class="txt muted"><i>Rating only — no written review</i></div>`}
      ${r.summary ? `<div class="sum">📝 ${esc(r.summary)}</div>` : ""}
      <div class="tags">${r.topics.map((t) => `<span class="tag">${esc(label(t))}</span>`).join("")}<span class="st ${r.replied ? "ok" : "bad"}">${r.replied ? "✅ Replied" : r.ticketStatus === "APPROVED" ? "🕐 Reply approved" : "⏳ Awaiting reply"}</span></div>
    </div>`).join("") : `<div class="muted">No ${esc(catName.toLowerCase())} reviews in this period.</div>`;

    $("out").hidden = false; // visible first: the share card is measured to decide 1 or 2 images
    buildShare(m, catName, total, sel, storesHit, awaiting);
    fitCard();
  }

  // ── Full tracking report: image card(s) + WhatsApp message ──
  const NO_DETAIL = ["other", "uncategorised"];
  const isReal = (t) => !NO_DETAIL.includes(t);
  // What the store has to do when a category goes up (or doesn't come down).
  const FIX = {
    staff_behavior: "Staff training: polite with parents, no phones or chatting on the floor, gentle with kids (no pulling, pushing or scolding), every zone watched",
    safety_injury: "Safety round of every zone before opening, staff stays with toddlers on big slides, tell the parent about any fall at once, first-aid kit checked daily",
    cleanliness_hygiene: "Cleaning checklist every hour (washrooms, play area, foam pit), manager signs it each shift",
    billing_refund: "Explain package, time and price before billing, rate card at the counter, manager settles refund issues the same day",
    crowding_queue: "Extra staff at counter and entry on weekends and peak hours, tell guests the waiting time upfront",
    equipment_rides: "Check all equipment before opening, close and tag broken rides, log every repair with date",
    food_beverage: "Check food freshness, taste and temperature, keep menu items in stock, clean F&B counter",
    pricing_value: "Explain clearly what each package includes, show combos and offers at the counter",
    booking_membership: "Confirm every booking on call/WhatsApp, train counter staff on cards, balance and memberships",
    birthday_party: "Party checklist agreed with the host, coordinator stays for the whole party, check all package items before start",
    socks_entry_policy: "Tell socks and entry rules before payment, clear board at the entrance",
    room_quality: "Inspect every room before check-in, fix AC, water and linen issues the same day",
    check_in_out: "Keep rooms ready on time, faster check-in and check-out",
    amenities: "Check pool and amenities daily, tell guests in advance if something is closed",
    heritage_experience: "Brief guests on activities and timings at check-in",
  };
  const fixFor = (t) => FIX[t] || (isReal(t) ? "Store managers to read these reviews and fix the cause" : "Mostly star-only or one-line reviews — store managers to check service on those days");
  const ORDER = { up: 0, new: 0, same: 1, down: 2, cleared: 3, none: 4 };
  const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const plain = (s) => s.replace(/[*_~`]/g, "");

  function trend(c, p) {
    if (c > p) return { key: p ? "up" : "new", icon: "🔴", word: p ? "Increased" : "New", col: "#c5221f", bg: "#fce8e6" };
    if (c < p) return { key: c ? "down" : "cleared", icon: c ? "🟢" : "✅", word: c ? "Dropped" : "Cleared", col: "#137333", bg: "#e6f4ea" };
    return c ? { key: "same", icon: "🟠", word: "No change", col: "#b06000", bg: "#fef7e0" } : { key: "none", icon: "⚪", word: "—", col: "#80868b", bg: "#f1f3f4" };
  }
  // increased first (biggest jump on top), then no change, dropped, cleared
  function byTrend(a, b) {
    const ka = ORDER[trend(a.c, a.p).key], kb = ORDER[trend(b.c, b.p).key];
    return ka - kb || (ka === 0 ? (b.c - b.p) - (a.c - a.p) : 0) || b.c - a.c || b.p - a.p;
  }

  function storesFor(m, t) {
    const map = new Map();
    for (const [list, k] of [[m.cur, "c"], [m.prev, "p"]]) {
      for (const r of list) {
        if (!r.topics.includes(t)) continue;
        const row = map.get(r.store) || { store: r.store, c: 0, p: 0 };
        row[k]++;
        map.set(r.store, row);
      }
    }
    return [...map.values()].sort((a, b) => b.c - a.c || (b.c - b.p) - (a.c - a.p) || a.store.localeCompare(b.store));
  }
  /** Example complaints for a category: reviews where it is the main topic first, then the most severe; never the same review twice. */
  function examplesFor(m, t, n, used) {
    const picks = m.cur
      .filter((r) => r.topics.includes(t) && (r.summary || r.text) && !used.has(r.id))
      .sort((a, b) => (a.topics[0] === t ? 0 : 1) - (b.topics[0] === t ? 0 : 1) || (SEV[a.severity] ?? 4) - (SEV[b.severity] ?? 4) || a.topics.length - b.topics.length)
      .slice(0, n);
    picks.forEach((r) => used.add(r.id));
    return picks.map((r) => ({ store: r.store, text: clip(r.summary || r.text, 115) }));
  }
  const topIssues = (s) => Object.entries(s.topics).filter(([t]) => isReal(t)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => label(t).toLowerCase()).join(", ");

  function buildPlan(m, awaiting, catName) {
    const all = state.cat === "all";
    const scope = all ? m.catRows.filter((r) => isReal(r.t)) : m.catRows.filter((r) => r.t === state.cat);
    const used = new Set();
    const fixes = scope
      .filter((r) => r.c > r.p || (r.c === r.p && r.c >= (all ? 2 : 1)))
      .sort(byTrend)
      .map((r, i) => ({ ...r, stores: storesFor(m, r.t).filter((s) => s.c), examples: i < 6 ? examplesFor(m, r.t, all ? 1 : 3, used) : [] }));
    const improved = scope.filter((r) => r.c < r.p).sort(byTrend).map((r) => ({ ...r, stores: storesFor(m, r.t).filter((s) => s.c) }));
    // who does what: the stores where complaints went up (else the ones with the most), each with its own issues
    const rising = m.storeRows.filter((s) => s.c > s.p).sort((a, b) => (b.c - b.p) - (a.c - a.p) || b.c - a.c);
    const focus = (rising.length ? rising : m.storeRows.filter((s) => s.c >= 2)).slice(0, 5);
    const actions = focus.map((s) => ({
      head: `${s.store} ${s.c > s.p ? `▲ +${s.c - s.p}` : `(${s.c})`}`,
      body: all && !topIssues(s) ? "check what went wrong (star-only / short reviews)" : `fix ${all ? topIssues(s) : catName.toLowerCase()}`,
    }));
    if (awaiting) actions.push({ head: `Reply to ${awaiting} pending review${awaiting > 1 ? "s" : ""}`, body: "today — Tickets sheet → set APPROVED" });
    return { fixes, improved, actions };
  }

  const CARD_STYLE = "width:600px;flex:none;background:#fff;color:#202124;font-family:Roboto,'Segoe UI',Arial,sans-serif;border-radius:14px;overflow:hidden;line-height:1.35";
  const SEC = "font-size:12.5px;font-weight:800;color:#5f6368;text-transform:uppercase;letter-spacing:.05em;margin:18px 0 6px";
  const TH = "padding:6px 0;border-bottom:2px solid #dadce0;font-size:10.5px;color:#80868b;text-transform:uppercase;letter-spacing:.03em;text-align:left;font-weight:700";
  const TD = "padding:6px 0;border-bottom:1px solid #eceff1;vertical-align:top";
  const R = ";text-align:right";

  function buildShare(m, catName, total, sel, storesHit, awaiting) {
    const per = state.per;
    const all = state.cat === "all";
    const plan = buildPlan(m, awaiting, catName);
    const scopeC = all ? m.cur.length : m.curSel.length;
    const scopeP = all ? m.prev.length : m.prevSel.length;
    const scopeChg = all ? total : sel;
    const verdict = scopeChg.d > 0 ? { t: `Complaints went UP vs ${per.vs} — action needed`, col: "#c5221f", bg: "#fce8e6", icon: "🔴" }
      : scopeChg.d < 0 ? { t: `Complaints went DOWN vs ${per.vs} — improving`, col: "#137333", bg: "#e6f4ea", icon: "🟢" }
      : { t: `Same as ${per.vs}`, col: "#5f6368", bg: "#f1f3f4", icon: "⚪" };
    const catTrack = all ? m.catRows.filter((r) => isReal(r.t) && (r.c || r.p)).sort(byTrend) : [];
    const noDetail = all ? m.catRows.filter((r) => !isReal(r.t)).reduce((a, r) => ({ c: a.c + r.c, p: a.p + r.p }), { c: 0, p: 0 }) : { c: 0, p: 0 };
    const storeRows = m.storeRows.filter((r) => r.c || r.p);
    const generated = `${fmtDay(TODAY)}, ${istTime(new Date().toISOString())}`;

    const chg = (c, p) => {
      const x = change(c, p);
      return `<span style="color:${x.d > 0 ? "#c5221f" : x.d < 0 ? "#137333" : "#80868b"};font-weight:700;white-space:nowrap">${esc(x.text)}</span>`;
    };
    const pill = (tr) => `<span style="display:inline-block;background:${tr.bg};color:${tr.col};border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:700;white-space:nowrap">${tr.icon} ${tr.word}</span>`;
    const box = (lbl, val, sub, subCol) => `<div style="flex:1;background:#f8f9fa;border:1px solid #e8eaed;border-radius:10px;padding:9px 6px;text-align:center">
      <div style="font-size:10.5px;color:#5f6368;text-transform:uppercase;letter-spacing:.05em;font-weight:700">${esc(lbl)}</div>
      <div style="font-size:27px;font-weight:800;line-height:1.2">${val}</div>
      <div style="font-size:12px;color:${subCol || "#5f6368"};font-weight:600">${sub}</div></div>`;

    const head = (note) => `<div style="background:linear-gradient(135deg,#c5221f,#e8453c);color:#fff;padding:16px 22px 14px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><div style="font-size:21px;font-weight:800">📊 Negative Review Report</div><div style="font-size:12px;opacity:.92;white-space:nowrap">${esc(note)}</div></div>
      <div style="font-size:14px;opacity:.95;margin-top:2px"><b>${esc(per.name)}:</b> ${esc(fmtRange(per.from, per.to))} · vs ${esc(fmtRange(per.pfrom, per.pto))}${all ? "" : ` · <b>${esc(catName)}</b>`}</div></div>`;
    const foot = `<div style="background:#f8f9fa;color:#80868b;font-size:11px;padding:9px 22px;display:flex;justify-content:space-between;gap:10px;margin-top:16px"><span>Generated ${esc(generated)}</span><span>Jus Jumpin Review AI · ${state.data.storeCount} outlets · live from Google</span></div>`;

    const kpis = `<div style="display:flex;gap:10px;padding:14px 22px 0">
      ${box(all ? "Negative reviews" : catName, scopeC, `${esc(scopeChg.text)} · was ${scopeP}`, scopeChg.d > 0 ? "#c5221f" : scopeChg.d < 0 ? "#137333" : "")}
      ${box("Stores affected", storesHit, `of ${state.data.storeCount}`)}
      ${box("Awaiting reply", awaiting, awaiting ? "reply today" : "all replied", awaiting ? "#b06000" : "#137333")}</div>
      <div style="margin:12px 22px 0;background:${verdict.bg};color:${verdict.col};border-radius:8px;padding:9px 12px;font-weight:700;font-size:14px">${verdict.icon} ${esc(verdict.t)}</div>`;

    const catSec = catTrack.length || noDetail.c || noDetail.p ? `<div style="${SEC}">📋 Category tracking</div>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
      <tr><th style="${TH}">Category</th><th style="${TH}${R}">Now</th><th style="${TH}${R};padding-left:10px">Before</th><th style="${TH}${R};padding-left:10px">Change</th><th style="${TH}${R}">Status</th></tr>
      ${catTrack.map((r) => `<tr><td style="${TD}">${esc(label(r.t))}</td><td style="${TD}${R};font-weight:800">${r.c}</td><td style="${TD}${R};padding-left:10px;color:#80868b">${r.p}</td><td style="${TD}${R};padding-left:10px">${chg(r.c, r.p)}</td><td style="${TD}${R}">${pill(trend(r.c, r.p))}</td></tr>`).join("")}
      ${noDetail.c || noDetail.p ? `<tr><td style="${TD};color:#80868b">No detail / not categorised</td><td style="${TD}${R};color:#80868b;font-weight:700">${noDetail.c}</td><td style="${TD}${R};padding-left:10px;color:#80868b">${noDetail.p}</td><td style="${TD}${R};padding-left:10px;color:#80868b">${esc(change(noDetail.c, noDetail.p).text)}</td><td style="${TD}${R};color:#80868b;font-size:11.5px">star-only / short</td></tr>` : ""}
      </table>` : "";

    const shownStores = storeRows.slice(0, 10);
    const storeSec = `<div style="${SEC}">🏬 ${all ? "Store tracking" : `Stores — ${esc(catName)}`}</div>` + (shownStores.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <tr><th style="${TH}">Store</th><th style="${TH}${R}">Now</th><th style="${TH}${R};padding-left:10px">Before</th><th style="${TH}${R};padding-left:10px">Change</th><th style="${TH};padding-left:14px">${all ? "Main issues" : "Status"}</th></tr>
        ${shownStores.map((s) => `<tr><td style="${TD};font-weight:700;white-space:nowrap">${trend(s.c, s.p).icon} ${esc(s.store)}</td><td style="${TD}${R};font-weight:800">${s.c}</td><td style="${TD}${R};padding-left:10px;color:#80868b">${s.p}</td><td style="${TD}${R};padding-left:10px">${chg(s.c, s.p)}</td>
          <td style="${TD};padding-left:14px;font-size:12.5px;color:#3c4043">${all ? (s.c ? esc(mainIssues(s) || "No detail") : `<span style="color:#137333;font-weight:700">✅ Cleared</span>`) : pill(trend(s.c, s.p))}</td></tr>`).join("")}
        </table>${storeRows.length > shownStores.length ? `<div style="font-size:12px;color:#80868b;margin-top:5px">+ ${storeRows.length - shownStores.length} more stores with fewer complaints</div>` : ""}`
      : `<div style="padding:16px 0;text-align:center;color:#137333;font-weight:700">✅ No ${esc(catName.toLowerCase())} complaints at any store</div>`);

    const shownFixes = plan.fixes.slice(0, 5);
    const fixSec = `<div style="${SEC}">🔴 We have to fix</div>` + (shownFixes.length ? shownFixes.map((f, i) => {
      const tr = trend(f.c, f.p);
      return `<div style="border:1px solid #e8eaed;border-left:5px solid ${tr.col};border-radius:10px;padding:9px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><div style="font-size:15px;font-weight:800">${i + 1}. ${esc(label(f.t))}</div><div style="font-size:13px;white-space:nowrap"><b>${f.c}</b> <span style="color:#80868b">was ${f.p}</span> ${chg(f.c, f.p)}</div></div>
        ${f.stores.length ? `<div style="font-size:13px;color:#3c4043;margin-top:3px"><b>Stores:</b> ${esc(f.stores.slice(0, 4).map((s) => `${s.store} ${s.c}`).join(", "))}${f.stores.length > 4 ? ` +${f.stores.length - 4} more` : ""}</div>` : ""}
        ${f.examples.map((x) => `<div style="font-size:12.5px;color:#5f6368;margin-top:3px;font-style:italic">“${esc(x.text)}” — ${esc(x.store)}</div>`).join("")}
        <div style="font-size:13px;margin-top:6px;background:#fef7e0;border-radius:6px;padding:6px 9px;color:#3c4043">👉 <b>Fix:</b> ${esc(fixFor(f.t))}</div></div>`;
    }).join("") + (plan.fixes.length > shownFixes.length ? `<div style="font-size:12.5px;color:#5f6368">Also: ${esc(plan.fixes.slice(shownFixes.length).map((f) => `${label(f.t)} ${f.c} (${change(f.c, f.p).text})`).join(", "))}</div>` : "")
      : `<div style="padding:9px 12px;background:#e6f4ea;color:#137333;border-radius:8px;font-weight:700;font-size:14px">✅ No ${all ? "category" : esc(catName.toLowerCase())} went up — keep the same standards</div>`);

    const impSec = plan.improved.length ? `<div style="${SEC}">🟢 Improved</div>` + plan.improved.slice(0, 6).map((r) => `<div style="font-size:13.5px;padding:3px 0">${trend(r.c, r.p).icon} <b>${esc(label(r.t))}</b> ${r.c} <span style="color:#80868b">was ${r.p}</span> ${chg(r.c, r.p)}${r.c ? ` <span style="color:#5f6368">— still at ${esc(r.stores.slice(0, 3).map((s) => s.store).join(", "))}</span>` : ""}</div>`).join("") : "";

    const planSec = `<div style="${SEC}">✅ Action plan</div>` + (plan.actions.length
      ? plan.actions.map((a, i) => `<div style="display:flex;gap:8px;font-size:13.5px;margin-bottom:5px"><span style="font-weight:800;min-width:18px">${i + 1}.</span><span><b>${esc(a.head)}</b>: ${esc(a.body)}</span></div>`).join("")
      : `<div style="font-size:13.5px;color:#137333;font-weight:700">Nothing urgent — keep the same standards</div>`) +
      `<div style="margin-top:8px;font-size:13px;color:#3c4043;font-weight:700">🙏 Store managers: reply in the group with what was done.</div>`;

    const partA = `${kpis}<div style="padding:0 22px">${catSec}${storeSec}</div>`;
    const partB = `<div style="padding:0 22px">${fixSec}${impSec}${planSec}</div>`;
    paintCards([head("") + partA + partB + foot]);
    // WhatsApp shrinks tall images until the text is unreadable — split a long report into two pages
    if ($("rcard0").offsetHeight > 1300) paintCards([head("Page 1 of 2") + partA + foot, head("Page 2 of 2 · Action plan") + partB + foot]);

    const text = buildText({ per, m, all, catName, scopeC, scopeP, scopeChg, total, verdict, storesHit, awaiting, catTrack, noDetail, storeRows, plan });
    $("shareText").value = text;
    $("waLink").href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  function buildText({ per, m, all, catName, scopeC, scopeP, scopeChg, total, verdict, storesHit, awaiting, catTrack, noDetail, storeRows, plan }) {
    const L = [`📊 *Negative Review Report — ${per.name}*`, `${fmtRange(per.from, per.to)} vs ${fmtRange(per.pfrom, per.pto)}`];
    if (!all) L.push(`Category: *${catName}*`);
    L.push("", `*${all ? "Negative reviews" : catName}: ${scopeC}* — ${scopeChg.text} (was ${scopeP})`);
    if (!all) L.push(`All negative reviews: ${m.cur.length} — ${total.text} (was ${m.prev.length})`);
    L.push(`${verdict.icon} ${verdict.t}`, `Stores affected: ${storesHit} of ${state.data.storeCount} · Awaiting reply: ${awaiting}`);

    if (catTrack.length || noDetail.c || noDetail.p) {
      L.push("", "*📋 Category tracking*");
      for (const r of catTrack) L.push(`${trend(r.c, r.p).icon} ${label(r.t)}: ${r.c} (was ${r.p}) ${change(r.c, r.p).text}`);
      if (noDetail.c || noDetail.p) L.push(`⚪ No detail / not categorised: ${noDetail.c} (was ${noDetail.p})`);
    }

    L.push("", "*🔴 We have to fix*");
    if (plan.fixes.length) {
      plan.fixes.slice(0, 6).forEach((f, i) => {
        L.push(`${i + 1}. *${label(f.t)}*: ${f.c} (was ${f.p}) ${change(f.c, f.p).text}`);
        if (f.stores.length) L.push(`    Stores: ${f.stores.slice(0, 5).map((s) => `${s.store} ${s.c}`).join(", ")}${f.stores.length > 5 ? ` +${f.stores.length - 5} more` : ""}`);
        for (const x of f.examples) L.push(`    _"${plain(x.text)}"_ — ${x.store}`);
        L.push(`    👉 Fix: ${fixFor(f.t)}`);
      });
      if (plan.fixes.length > 6) L.push(`Also: ${plan.fixes.slice(6).map((f) => `${label(f.t)} ${f.c} (${change(f.c, f.p).text})`).join(", ")}`);
    } else {
      L.push(`✅ No ${all ? "category" : catName.toLowerCase()} went up — keep the same standards`);
    }

    if (plan.improved.length) {
      L.push("", "*🟢 Improved*");
      for (const r of plan.improved) L.push(`${trend(r.c, r.p).icon} ${label(r.t)}: ${r.c} (was ${r.p}) ${change(r.c, r.p).text}${r.c ? ` — still at ${r.stores.slice(0, 3).map((s) => s.store).join(", ")}` : ""}`);
    }

    const active = storeRows.filter((s) => s.c);
    const cleared = storeRows.filter((s) => !s.c);
    L.push("", all ? "*🏬 Store tracking*" : `*🏬 Stores — ${catName}*`);
    if (!active.length) L.push(`✅ No ${all ? "negative reviews" : `${catName.toLowerCase()} complaints`} at any store`);
    for (const s of active.slice(0, 10)) {
      const issues = all ? mainIssues(s) : "";
      L.push(`${trend(s.c, s.p).icon} ${s.store}: ${s.c} (was ${s.p}) ${change(s.c, s.p).text}${issues ? ` — ${issues}` : ""}`);
    }
    if (active.length > 10) L.push(`+ ${active.length - 10} more stores`);
    if (cleared.length) L.push(`✅ Cleared (0 now): ${cleared.map((s) => s.store).join(", ")}`);

    L.push("", "*✅ Action plan*");
    if (!plan.actions.length) L.push("Nothing urgent — keep the same standards");
    plan.actions.forEach((a, i) => L.push(`${i + 1}. *${a.head}*: ${a.body}`));
    L.push("", "🙏 Store managers: please reply here with what was done.");
    return L.join("\n");
  }

  // ── Image cards ──
  let blobCache = null;
  let warmTimer = 0;
  function paintCards(cards) {
    const n = cards.length;
    $("shareCard").innerHTML = cards.map((h, i) => `<div class="cw"><div class="rcard" id="rcard${i}" style="${CARD_STYLE}">${h}</div>
      <button class="copy cbtn" type="button" data-i="${i}">📋 Copy image${n > 1 ? ` ${i + 1} of ${n}` : ""}</button></div>`).join("");
    blobCache = null;
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => cardBlobs(), 900); // pre-render so the phone share sheet opens instantly
  }
  function renderCard(el) {
    const opts = { scale: 2, backgroundColor: "#ffffff", onclone: (doc) => { doc.getElementById(el.id).style.zoom = 1; } };
    return html2canvas(el, opts).then((c) => new Promise((r) => c.toBlob(r, "image/png")));
  }
  /** One PNG promise per card, rendered one after another and cached until the report changes. */
  function cardBlobs() {
    if (!blobCache) {
      let chain = Promise.resolve();
      const mine = [...$("shareCard").querySelectorAll(".rcard")].map((el) => (chain = chain.then(() => renderCard(el))));
      chain.catch(() => { if (blobCache === mine) blobCache = null; });
      blobCache = mine;
    }
    return blobCache;
  }
  const fileName = (i, n) => `negative-review-report-${state.per.from}-to-${state.per.to}${n > 1 ? `-${i + 1}of${n}` : ""}.png`;
  function flash(btn, msg) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => (btn.textContent = old), 2500); }
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function fitCard() {
    const w = $("shareCard").clientWidth;
    if (!w) return; // not laid out yet
    const z = Math.min(1, w / 600);
    $("shareCard").querySelectorAll(".rcard").forEach((c) => (c.style.zoom = z));
  }

  // ── Events ──
  document.querySelectorAll(".chip[data-p]").forEach((b) => b.addEventListener("click", () => { state.p = b.dataset.p; load(); }));
  $("go").addEventListener("click", () => { state.cf = $("from").value; state.ct = $("to").value; load(); });
  $("cat").addEventListener("change", (e) => { state.cat = e.target.value; syncUrl(); render(); });
  $("catTable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-cat]");
    if (!tr) return;
    state.cat = state.cat === tr.dataset.cat ? "all" : tr.dataset.cat;
    syncUrl(); render();
    $("storeTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("shareCard").addEventListener("click", async (e) => {
    const btn = e.target.closest(".cbtn");
    if (!btn) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": cardBlobs()[+btn.dataset.i] })]);
      flash(btn, "✅ Copied — Ctrl+V in WhatsApp");
    } catch { flash(btn, "Copy blocked here — use Download"); }
  });
  $("shareImg").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const probe = new File([new Blob(["x"])], "x.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [probe] })) {
      // phone: share sheet → WhatsApp, image(s) with the message as caption
      const blobs = await Promise.all(cardBlobs());
      const files = blobs.map((b, i) => new File([b], fileName(i, blobs.length), { type: "image/png" }));
      const text = $("shareText").value;
      const payload = navigator.canShare({ files, text }) ? { files, text } : { files };
      try { await navigator.share(payload); } catch (err) { if (err.name === "NotAllowedError") flash(btn, "Tap again to send"); }
      return;
    }
    // PC browsers can't hand images to WhatsApp — copy image 1 for Ctrl+V (each image has its own Copy button)
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": cardBlobs()[0] })]);
      flash(btn, cardBlobs().length > 1 ? "✅ Image 1 copied — Ctrl+V, then copy image 2" : "✅ Copied — open WhatsApp, press Ctrl+V");
    } catch {
      const blobs = await Promise.all(cardBlobs());
      blobs.forEach((b, i) => saveBlob(b, fileName(i, blobs.length)));
      flash(btn, "Downloaded — attach in WhatsApp");
    }
  });
  $("dlImg").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const blobs = await Promise.all(cardBlobs());
    blobs.forEach((b, i) => saveBlob(b, fileName(i, blobs.length)));
    flash(btn, "✅ Downloaded");
  });
  $("copyText").addEventListener("click", (e) => {
    const t = $("shareText");
    const done = () => flash(e.target, "✅ Copied");
    if (navigator.clipboard) navigator.clipboard.writeText(t.value).then(done, () => { t.select(); document.execCommand("copy"); done(); });
    else { t.select(); document.execCommand("copy"); done(); }
  });
  window.addEventListener("resize", fitCard);

  $("from").max = TODAY; $("to").max = TODAY;
  $("from").value = state.cf; $("to").value = state.ct;
  load();
})();
