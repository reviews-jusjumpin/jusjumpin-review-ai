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

    buildShare(m, catName, total, sel);
    $("out").hidden = false;
    fitCard();
  }

  // ── Shareable summary (image + WhatsApp text) ──
  function buildShare(m, catName, total, sel) {
    const per = state.per;
    const topCats = m.catRows.filter((r) => r.c || r.p).slice(0, 8);
    const topStores = m.storeRows.filter((r) => r.c || r.p).slice(0, 8);
    const chgCell = (c, p) => {
      const x = change(c, p);
      const col = x.d > 0 ? "#c5221f" : x.d < 0 ? "#137333" : "#80868b";
      return `<span style="color:${col};font-weight:600">${esc(x.text)}</span>`;
    };
    const rowsHtml = (rows, nameFn) => rows.map((r) => `<tr><td style="padding:7px 0;border-bottom:1px solid #e8eaed">${esc(nameFn(r))}</td><td style="padding:7px 0;border-bottom:1px solid #e8eaed;text-align:right;font-weight:700">${r.c}</td><td style="padding:7px 0 7px 14px;border-bottom:1px solid #e8eaed;text-align:right">${chgCell(r.c, r.p)}</td></tr>`).join("");
    const table = (title, rows, nameFn) => rows.length ? `<div style="font-size:13px;font-weight:700;color:#5f6368;text-transform:uppercase;letter-spacing:.04em;margin:16px 0 4px">${esc(title)}</div><table style="width:100%;border-collapse:collapse;font-size:14px">${rowsHtml(rows, nameFn)}</table>` : "";

    $("shareCard").innerHTML = `<div id="rcard" style="width:600px;background:#fff;color:#202124;font-family:Roboto,'Segoe UI',Arial,sans-serif;border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#c5221f,#e8453c);color:#fff;padding:18px 24px">
        <div style="font-size:21px;font-weight:800">📊 Negative Review Report</div>
        <div style="font-size:14px;opacity:.92;margin-top:2px">${esc(per.name)}: ${esc(fmtRange(per.from, per.to))} · vs ${esc(fmtRange(per.pfrom, per.pto))}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <span style="background:rgba(255,255,255,.18);border-radius:999px;padding:5px 12px;font-size:14px"><b>${m.cur.length}</b> negative reviews · ${esc(total.text)}</span>
          ${state.cat === "all" ? "" : `<span style="background:rgba(255,255,255,.18);border-radius:999px;padding:5px 12px;font-size:14px">${esc(catName)}: <b>${m.curSel.length}</b> · ${esc(sel.text)}</span>`}
        </div>
      </div>
      <div style="padding:4px 24px 18px">
        ${state.cat === "all" ? table("By category", topCats, (r) => label(r.t)) : ""}
        ${table(state.cat === "all" ? "By store" : `Stores — ${catName}`, topStores, (r) => r.store)}
        ${!topStores.length ? `<div style="padding:24px 0;text-align:center;color:#137333;font-weight:600">✅ No ${esc(catName.toLowerCase())} complaints in this period</div>` : ""}
      </div>
      <div style="background:#f8f9fa;color:#80868b;font-size:11.5px;padding:9px 24px;text-align:right">Jus Jumpin Review AI · ${state.data.storeCount} outlets · live from Google</div>
    </div>`;

    const lines = [`📊 *Negative Review Report — ${per.name}*`, `${fmtRange(per.from, per.to)} vs ${fmtRange(per.pfrom, per.pto)}`, "", `*Negative reviews: ${m.cur.length}* (${total.text}, was ${m.prev.length})`];
    if (state.cat !== "all") lines.push(`*${catName}: ${m.curSel.length}* (${sel.text}, was ${m.prevSel.length})`);
    if (state.cat === "all" && topCats.length) lines.push("", "*By category*", ...topCats.map((r) => `• ${label(r.t)}: ${r.c} (${change(r.c, r.p).text})`));
    if (topStores.length) lines.push("", state.cat === "all" ? "*By store*" : `*Stores — ${catName}*`, ...topStores.map((r) => `• ${r.store}: ${r.c} (${change(r.c, r.p).text})`));
    $("shareText").value = lines.join("\n");
    $("waLink").href = `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  function renderCard() {
    const opts = { scale: 2, backgroundColor: "#ffffff", onclone: (doc) => { doc.getElementById("rcard").style.zoom = 1; } };
    return html2canvas($("rcard"), opts).then((c) => new Promise((r) => c.toBlob(r, "image/png")));
  }
  const fileName = () => `negative-review-report-${state.per.from}-to-${state.per.to}.png`;
  function flash(btn, msg) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => (btn.textContent = old), 2500); }
  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function fitCard() {
    const card = $("rcard");
    if (card) card.style.zoom = Math.min(1, $("shareCard").clientWidth / 600);
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
  $("copyImg").addEventListener("click", async (e) => {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": renderCard() })]); flash(e.target, "✅ Copied — paste in WhatsApp"); }
    catch { flash(e.target, "Copy blocked here — use Download"); }
  });
  $("shareImg").addEventListener("click", async (e) => {
    const probe = new File([new Blob(["x"])], "x.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [probe] })) {
      // phone: share sheet → WhatsApp
      const file = new File([await renderCard()], fileName(), { type: "image/png" });
      try { await navigator.share({ files: [file] }); } catch { /* share sheet closed */ }
      return;
    }
    // PC browsers can't hand an image to WhatsApp directly — copy it for Ctrl+V instead
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": renderCard() })]);
      flash(e.target, "✅ Copied — open WhatsApp, press Ctrl+V");
    } catch {
      saveBlob(await renderCard(), fileName());
      flash(e.target, "Downloaded — attach it in WhatsApp");
    }
  });
  $("dlImg").addEventListener("click", async (e) => { saveBlob(await renderCard(), fileName()); flash(e.target, "✅ Downloaded"); });
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
