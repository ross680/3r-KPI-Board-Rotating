/* Grading, ranking, and sheet-to-snapshot math for the 3R KPI board.
   No DOM. The TV page and the Node tests both load this file. */
(function (root, factory) {
  var settings = (typeof module === "object" && module.exports && typeof require === "function" && typeof document === "undefined")
    ? require("./settings.js") : root.BOARD_SETTINGS;
  var api = factory(settings);
  if (typeof module === "object" && module.exports && typeof require === "function" && typeof document === "undefined") module.exports = api;
  else root.Scoring = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SETTINGS) {
  var TZ = SETTINGS.TIMEZONE;
  var METRICS = SETTINGS.METRICS, SALES_METRICS = SETTINGS.SALES_METRICS, APP_METRICS = SETTINGS.APP_METRICS;
  var MK = ["rev","jobs","paid","opp","conv","sold","soldN","estN","gm","hrs","leads","recall","booked","instRev","svcRev","instN","soldHrs","warr"];

  function nyParts(date) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "short", hourCycle: "h23"
    });
    var map = {};
    fmt.formatToParts(date).forEach(function (p) { if (p.type !== "literal") map[p.type] = p.value; });
    var hh = +map.hour;
    if (hh === 24) hh = 0;
    var wd = {Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6}[map.weekday];
    return { y:+map.year, m:+map.month - 1, d:+map.day, hh:hh, mm:+map.minute, ss:+map.second, wd:wd };
  }
  function nyNow() { return new Date(); }
  /* Wall-clock time in America/New_York, including the right DST offset. */
  function nyDate(y, m, d, hh, mm, ss) {
    hh = hh || 0; mm = mm || 0; ss = ss || 0;
    var utcGuess = Date.UTC(y, m, d, hh, mm, ss);
    var got = nyParts(new Date(utcGuess));
    var gotUtc = Date.UTC(got.y, got.m, got.d, got.hh, got.mm, got.ss);
    return new Date(utcGuess - (gotUtc - utcGuess));
  }
  function nyYMD(date) {
    var p = nyParts(date);
    return p.y + "-" + String(p.m + 1).padStart(2, "0") + "-" + String(p.d).padStart(2, "0");
  }
  function addNyDays(date, days) {
    var p = nyParts(date);
    return nyDate(p.y, p.m, p.d + days, p.hh, p.mm, p.ss);
  }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function nyDayIndex(date) {
    var p = nyParts(date);
    return Math.round(Date.UTC(p.y, p.m, p.d) / 864e5);
  }
  function ymdParts(p) {
    return p.y + "-" + String(p.m + 1).padStart(2, "0") + "-" + String(p.d).padStart(2, "0");
  }

  function fromExcel(v) {
    var whole = Math.floor(v);
    var frac = v - whole;
    var utc = Date.UTC(1970, 0, 1) + Math.round((whole - 25569) * 864e5);
    var dt = new Date(utc);
    var totalMin = Math.round(frac * 1440);
    var hh = Math.floor(totalMin / 60);
    var mm = totalMin % 60;
    var extra = 0;
    if (hh >= 24) { extra = Math.floor(hh / 24); hh = hh % 24; }
    var d = nyDate(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), hh, mm, 0);
    return extra ? addNyDays(d, extra) : d;
  }
  function toDate(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number" && isFinite(v) && v > 20000 && v < 80000) return fromExcel(v);
    if (v == null || v === "") return null;
    var s = String(v).trim();
    var md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/);
    if (md) {
      var y = +md[3]; if (md[3].length === 2) y += 2000;
      var hh = +(md[4] || 0), mi = +(md[5] || 0), ss = +(md[6] || 0);
      var ap = (md[7] || "").toLowerCase();
      if (ap) { if (hh === 12) hh = 0; if (ap === "pm") hh += 12; }
      return nyDate(y, +md[1] - 1, +md[2], hh, mi, ss);
    }
    var isoD = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoD) return nyDate(+isoD[1], +isoD[2] - 1, +isoD[3], 0, 0, 0);
    var isoL = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (isoL) return nyDate(+isoL[1], +isoL[2] - 1, +isoL[3], +isoL[4], +isoL[5], +(isoL[6] || 0));
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v == null || v === "") return 0;
    var s = String(v).trim();
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/\$/, ""));
    s = s.replace(/[^0-9.]/g, "");
    var n = parseFloat(s) || 0;
    return neg ? -n : n;
  }
  function bool(v) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v == null || v === "") return false;
    return /^(true|yes|y|1)$/i.test(String(v).trim());
  }
  function key(name) { return String(name || "").trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function money(n, short) {
    n = +n || 0;
    if (short && Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
    if (short && Math.abs(n) >= 1e4) return "$" + Math.round(n / 1e3) + "K";
    return (n < 0 ? "-" : "") + "$" + Math.round(Math.abs(n)).toLocaleString();
  }
  function pct(n) { return Math.round((+n || 0) * 100) + "%"; }
  function fmtM(m, v) {
    return m.fmt === "$" ? money(v) : m.fmt === "%" ? pct(v) : m.fmt === "★" ? (v ? (+v).toFixed(1) + "★" : "—") : String(Math.round((+v || 0) * 10) / 10);
  }
  function initials(n) { return String(n || "?").trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase(); }
  function firstName(n) { return String(n || "").trim().split(/\s+/)[0]; }
  function hashStr(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  function sheetRows(wb, name) {
    if (!wb) return [];
    if (wb.__rows) return wb.__rows[String(name).trim().toLowerCase()] || [];
    var XLSX = root.XLSX;
    if (!XLSX || !wb.SheetNames) return [];
    var n = wb.SheetNames.find(function (x) { return x.trim().toLowerCase() === name.toLowerCase(); });
    if (!n) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1, raw:true, defval:""});
  }
  function firstRows(wb, names) {
    for (var i = 0; i < names.length; i++) { var r = sheetRows(wb, names[i]); if (r.length > 1) return r; }
    return [];
  }
  function kvSheet(rows) {
    var out = {};
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var k = String(r[0] == null ? "" : r[0]).trim();
      if (k.toLowerCase() === "date") break;
      if (k && !/^[💡⚠]/u.test(k)) out[k] = {v:num(r[1]), raw:r[1], label:String(r[2] || k), where:String(r[3] || "")};
    }
    return out;
  }
  function headerIndex(rows, test) {
    var i = rows.findIndex(test); if (i < 0) return {i:-1, h:{}};
    var h = {}; rows[i].forEach(function (c, j) { h[String(c).trim().toLowerCase()] = j; }); return {i:i, h:h};
  }
  function zeros() { return Array(12).fill(0); }
  function newBucket() { var o = {}; MK.forEach(function (k) { o[k] = zeros(); }); return o; }
  function newFlat() { var o = {}; MK.forEach(function (k) { o[k] = 0; }); return o; }
  function sumTo(arr, M) { return (arr || []).slice(0, M + 1).reduce(function (a, b) { return a + (+b || 0); }, 0); }

  function shiftLimitMinutes(shift) {
    var m = String(shift || "08:00").match(/(\d{1,2}):(\d{2})/);
    var sh = m ? +m[1] : 8;
    var sm = m ? +m[2] : 0;
    return sh * 60 + sm + SETTINGS.GRACE_MIN;
  }

  function buildSnapshot(wb, now) {
    now = now || nyNow();
    var pNow = nyParts(now);
    var Y = pNow.y, M = pNow.m;
    var yStart = nyDate(Y, 0, 1, 0, 0, 0);
    var l30 = addNyDays(now, -30);
    var goals = kvSheet(sheetRows(wb, "Goals"));
    var ytdGoals = kvSheet(sheetRows(wb, "YTD Goals"));
    var actuals = kvSheet(sheetRows(wb, "Actuals"));

    var lbRows = sheetRows(wb, "Leaderboard");
    var lb = headerIndex(lbRows, function (r) { return String(r[0]).trim().toLowerCase() === "name"; });
    var lbi = lb.i, lbh = lb.h;
    var board = {};
    if (lbi >= 0) lbRows.slice(lbi + 1).forEach(function (r) {
      var nm = String(r[lbh.name] == null ? "" : r[lbh.name]).trim(); if (!nm || nm.startsWith("←")) return;
      var g = function (c) { return num(r[lbh[c]]); };
      board[key(nm)] = {name:nm, status:String(r[lbh.status] == null ? "active" : r[lbh.status]).trim().toLowerCase() || "active",
        mem_mtd:g("mem_mtd"), rv_mtd:g("rv_mtd"), inst_mtd:g("inst_mtd"), mem_ytd:g("mem_ytd"), rv_ytd:g("rv_ytd"),
        rev_ytd:g("rev_ytd"), sold_ytd:g("sold_ytd")};
    });
    var rec = function (name) {
      var rows = sheetRows(wb, name);
      var i = headerIndex(rows, function (r) { return String(r[0]).trim().toLowerCase() === "tech name"; }).i;
      var o = {};
      if (i >= 0) rows.slice(i + 1).forEach(function (r) {
        var nm = String(r[0]).trim(); if (!nm) return;
        var months = []; for (var m = 1; m <= 12; m++) months.push(num(r[m]));
        o[key(nm)] = months;
      });
      return o;
    };
    var cbRec = rec("Call Back Record"), instRec = rec("Install Record");

    var T = {};
    var tech = function (nm) {
      var k = key(nm); if (!k) return null;
      if (!T[k]) T[k] = {k:k, full:String(nm).trim(), y:newBucket(), l30:newFlat(), open:[], openAmt:0};
      else if (String(nm).trim().length > T[k].full.length) T[k].full = String(nm).trim();
      return T[k];
    };
    var co = {y:newBucket(), l30:newFlat()};
    var maxDate = null, jobRows = 0, estRows = 0; var flags = [];
    var add = function (targets, d, f) {
      if (!d) return;
      var dp = nyParts(d);
      var inY = dp.y === Y && d >= yStart && d <= now;
      var in30 = d >= l30 && d <= now;
      for (var i = 0; i < targets.length; i++) if (targets[i]) {
        if (inY) f(targets[i].y, dp.m, true);
        if (in30) f(targets[i].l30, null, false);
      }
    };
    var inc = function (o, m, k, v) { if (m == null) o[k] += v; else o[k][m] += v; };

    var jr = firstRows(wb, ["ST Jobs", "Automation Jobs"]);
    var jhRes = headerIndex(jr, function (r) { return r.some(function (c) { return String(c).trim().toLowerCase() === "primary technician"; }); });
    var ji = jhRes.i, jh = jhRes.h;
    var col = function (r, n) { return jh[n] != null ? r[jh[n]] : ""; };
    var apRows = sheetRows(wb, "ST Appointments");
    var apRes = headerIndex(apRows, function (r) { return String(r[0]).trim().toLowerCase() === "job id"; });
    var api = apRes.i, aph = apRes.h;
    var apptHrs = {};
    if (api >= 0) apRows.slice(api + 1).forEach(function (r) {
      var id = String(r[aph["job id"]] == null ? "" : r[aph["job id"]]).trim();
      if (!id) return;
      // One job can have several appointments. The sheet comment says they add up.
      apptHrs[id] = (apptHrs[id] || 0) + num(r[aph["appointment hours"]]);
    });
    var useAppt = api >= 0;
    if (ji >= 0) jr.slice(ji + 1).forEach(function (r) {
      var status = String(col(r, "status")).trim().toLowerCase(); if (!status) return; jobRows++;
      var created = toDate(col(r, "created date"));
      if (status !== "canceled" && status !== "cancelled") add([co], created, function (o, m) { inc(o, m, "booked", 1); });
      var lead = String(col(r, "lead generated by")).trim();
      if (lead) add([tech(lead), co], created, function (o, m) { inc(o, m, "leads", 1); });
      if (status !== "completed") return;
      var d = toDate(col(r, "completion date")); if (!d) return;
      if (!maxDate || d > maxDate) maxDate = d;
      var dp = nyParts(d);
      var t = tech(col(r, "primary technician"));
      var rev = num(col(r, "jobs total revenue") || col(r, "jobs total"));
      var opp = bool(col(r, "opportunity")), conv = bool(col(r, "converted")), recall = bool(col(r, "recall"));
      var gm = num(col(r, "jobs gross margin")), hrs = num(col(r, "total hours worked"));
      var soldHrs = num(col(r, "sold hours")), warr = bool(col(r, "warranty"));
      var isInst = /install|replace|new system/i.test(String(col(r, "business unit")) + " " + String(col(r, "job type")));
      var jtype = String(col(r, "job type") || "");
      var jobId = String(col(r, "job id") == null ? "" : col(r, "job id")).trim();
      var hasAppt = useAppt && Object.prototype.hasOwnProperty.call(apptHrs, jobId);
      // Missing appointment row falls back to hours worked. A recorded 0 stays 0.
      var len = hasAppt ? apptHrs[jobId] : hrs;
      if (len > SETTINGS.INSTALL_HOURS && (useAppt || jh["total hours worked"] != null) && dp.y === Y) {
        if (SETTINGS.INSTALL_TYPE.test(jtype) && !SETTINGS.NOT_INSTALL.test(jtype)) add([t, co], d, function (o, m) { inc(o, m, "instN", 1); });
        else flags.push({n:String(col(r, "job #") || col(r, "job id") || ""), d:nyYMD(d), tech:String(col(r, "primary technician") || "Unassigned").trim(), type:jtype || "(no job type)", hrs:Math.round(len * 10) / 10, rev:Math.round(rev), bu:String(col(r, "business unit") || "")});
      }
      add([t, co], d, function (o, m) {
        inc(o, m, "rev", rev); inc(o, m, "jobs", 1); if (rev > 0) inc(o, m, "paid", 1); if (opp) inc(o, m, "opp", 1); if (opp && conv) inc(o, m, "conv", 1);
        if (recall) inc(o, m, "recall", 1); inc(o, m, "gm", gm); inc(o, m, "hrs", hrs); inc(o, m, "soldHrs", soldHrs); if (warr) inc(o, m, "warr", 1); inc(o, m, isInst ? "instRev" : "svcRev", rev);
      });
    });

    var er = firstRows(wb, ["ST Estimates", "Automation Estimates"]);
    var ehRes = headerIndex(er, function (r) { return r.some(function (c) { return String(c).trim().toLowerCase() === "estimate status"; }); });
    var ei = ehRes.i, eh = ehRes.h;
    if (ei >= 0) er.slice(ei + 1).forEach(function (r) {
      var st = String(r[eh["estimate status"]]).trim().toLowerCase(); if (!st) return; estRows++;
      var t = tech(r[eh["sold by"]] || r[eh["estimate created by"]]);
      var amt = num(r[eh["estimates total"]]);
      var cd = toDate(r[eh["creation date"]]), sd = toDate(r[eh["sold on"]]);
      if (cd && (!maxDate || cd > maxDate)) maxDate = cd;
      add([t, co], cd, function (o, m) { inc(o, m, "estN", 1); });
      // A sold estimate with a blank sold-on date still counts, dated when it was written.
      if (st === "sold") add([t, co], sd || cd, function (o, m) { inc(o, m, "sold", amt); inc(o, m, "soldN", 1); });
      if (st === "open" && t) {
        t.openAmt += amt;
        var fu0 = toDate(r[eh["follow up date"]]);
        // Due today is not overdue. Overdue starts the next New York morning.
        if (fu0 && nyDayIndex(fu0) < nyDayIndex(now)) t.overdueN = (t.overdueN || 0) + 1;
        var fu = fu0;
        t.open.push({n:String(r[eh["estimate name"]] || "Estimate").slice(0, 60), a:Math.round(amt), d:cd ? nyYMD(cd) : "", fu:fu ? nyYMD(fu) : ""});
      }
    });
    Object.keys(board).forEach(function (k) { if (!T[k]) tech(board[k].name); });

    var stRows = sheetRows(wb, "ST Techs");
    var stRes = headerIndex(stRows, function (r) { return String(r[0]).trim().toLowerCase() === "name"; });
    var sti = stRes.i, sth = stRes.h;
    var stById = {};
    if (sti >= 0) stRows.slice(sti + 1).forEach(function (r) {
      var nm = String(r[sth.name] || "").replace(/\s+tech$/i, "").trim(); if (!nm) return;
      var team = String(r[sth.team] || ""), active = String(r[sth.active] == null ? "TRUE" : r[sth.active]).toUpperCase() !== "FALSE";
      var start = toDate(r[sth["start date"]]) || toDate(r[sth["created on"]]);
      var info = {name:nm, id:String(r[sth["technician id"]] || ""), team:team, start:start ? nyYMD(start) : "", shift:String(r[sth["shift start"]] || "08:00"), active:active};
      stById[info.id] = info;
      var field = active && SETTINGS.FIELD_TEAM.test(team) && !/manager|office|part/i.test(team);
      var t = (field || (active && /manager|sales/i.test(team + " " + (r[sth.positions] || "")))) ? tech(nm) : T[key(nm)];
      if (!t) return;
      var sells = active && /manager/i.test(team) && (t.y.sold.reduce(function (a, b) { return a + b; }, 0) + t.y.rev.reduce(function (a, b) { return a + b; }, 0)) > 0;
      t.team = team; t.stId = info.id; t.startDate = info.start; t.shift = info.shift; t.stActive = active; t.autoShow = field || sells;
      t.role = /apprentic/i.test(team) ? "apprentice" : "tech";
    });

    var tsRows = sheetRows(wb, "ST Timesheets");
    var tsRes = headerIndex(tsRows, function (r) { return String(r[0]).trim().toLowerCase() === "employee"; });
    var tsi = tsRes.i, tsh = tsRes.h;
    var per = {}, holidays = {};
    if (tsi >= 0) tsRows.slice(tsi + 1).forEach(function (r) {
      var st = toDate(r[tsh.start]); if (!st) return;
      var stp = nyParts(st); if (stp.y !== Y) return;
      var nm = String((stById[String(r[tsh["employee id"]])] || {}).name || r[tsh.employee] || "").replace(/\s+tech$/i, "").trim();
      var code = String(r[tsh.code] || ""), type = String(r[tsh["code type"]] || "");
      var hrs = num(r[tsh.hours]);
      var day = ymdParts(stp);
      if (/holiday/i.test(code)) holidays[day] = true;
      var k = key(nm); if (!T[k]) return;
      var p = per[k] || (per[k] = {clock:{}, pto:{}, hrs:{}});
      if (type === "ClockInOut") {
        var mins = stp.hh * 60 + stp.mm;
        if (p.clock[day] == null || mins < p.clock[day]) p.clock[day] = mins;
        p.hrs[day] = (p.hrs[day] || 0) + hrs;
      } else if (type === "PaidTimeOff" && !/holiday/i.test(code)) {
        p.pto[day] = (p.pto[day] || 0) + (hrs || 8);
      }
    });
    var todayNoon = nyDate(Y, M, pNow.d, 12, 0, 0);
    var yestNoon = addNyDays(todayNoon, -1);
    Object.keys(per).forEach(function (k) {
      var p = per[k];
      // PTO with no clock-ins is still attendance. A person with neither is left unscored.
      if (!Object.keys(p.clock).length && !Object.keys(p.pto).length) return;
      var t = T[k];
      var limit = shiftLimitMinutes(t.shift);
      var A = {sched:zeros(), days:zeros(), late:zeros(), missed:zeros(), pto:zeros(), hrs:zeros()};
      var L = {sched:0, days:0, late:0, missed:0, pto:0, hrs:0};
      var cursor = nyDate(Y, 0, 1, 12, 0, 0);
      var guard = 0;
      while (nyDayIndex(cursor) <= nyDayIndex(yestNoon) && guard++ < 400) {
        var dp = nyParts(cursor);
        var k2 = ymdParts(dp);
        var dayStart = nyDate(dp.y, dp.m, dp.d, 0, 0, 0);
        var in30 = dayStart >= l30;
        var wd = dp.wd >= 1 && dp.wd <= 5;
        if (!(t.startDate && k2 < t.startDate)) {
          var worked = p.clock[k2] != null, ptoH = p.pto[k2] || 0, hol = !!holidays[k2];
          var addA = function (f, v) { A[f][dp.m] += v; if (in30) L[f] += v; };
          if (ptoH) addA("pto", ptoH);
          if (worked) { addA("days", 1); addA("hrs", p.hrs[k2] || 0); if (p.clock[k2] > limit) addA("late", 1); }
          if (wd && !hol) { addA("sched", 1); if (!worked && !ptoH) addA("missed", 1); }
        }
        cursor = addNyDays(cursor, 1);
      }
      t.att = {y:A, l30:L};
    });

    var byStId = {}; Object.keys(stById).forEach(function (id) { byStId[id] = stById[id]; });
    var nameKey = function (id) { var x = byStId[String(id)]; return x ? key(x.name) : null; };
    var auto = {mem:false, rv:false, cb:false};
    var coMem = zeros(), coRv = zeros(), coMemL30 = 0, coRvL30 = 0;
    var memRows = sheetRows(wb, "ST Memberships");
    var memRes = headerIndex(memRows, function (r) { return String(r[0]).trim().toLowerCase() === "membership id"; });
    if (memRes.i >= 0) {
      auto.mem = true;
      Object.keys(T).forEach(function (k) { T[k].memM = zeros(); T[k].memL30 = 0; });
      memRows.slice(memRes.i + 1).forEach(function (r) {
        var h = memRes.h;
        var d = toDate(r[h.created]); if (!d || d > now) return;
        if (/renew/i.test(String(r[h.type] || ""))) return;
        var dp = nyParts(d);
        var k = nameKey(r[h["sold by id"]]) || key(r[h["sold by"]]);
        if (dp.y === Y) {
          coMem[dp.m]++; if (k && T[k]) T[k].memM[dp.m]++;
        }
        if (d >= l30) {
          coMemL30++; if (k && T[k]) T[k].memL30++;
        }
      });
    }
    var rvRows = sheetRows(wb, "ST Reviews");
    var rvRes = headerIndex(rvRows, function (r) { return String(r[0]).trim().toLowerCase() === "published"; });
    var autoReviews = [];
    if (rvRes.i >= 0) {
      auto.rv = true;
      Object.keys(T).forEach(function (k) { T[k].rvM = zeros(); T[k].rvL30 = 0; });
      var firsts = Object.keys(T).map(function (k) {
        return {k:k, re:new RegExp("\\b" + firstName(T[k].full).replace(/[^A-Za-z]/g, "") + "\\b", "i")};
      }).filter(function (x) { return x.re.source.length > 6; });
      rvRows.slice(rvRes.i + 1).forEach(function (r) {
        var h = rvRes.h;
        var d = toDate(r[h.published]); if (!d) return;
        var rating = num(r[h.rating]);
        var text = String(r[h.review] || "").trim();
        if (text.length > 30 && (rating >= 4 || !rating)) autoReviews.push({by:String(r[h.platform] || "Google") + " review", t:text.slice(0, 400), s:rating || 5, d:d.toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:TZ}), at:d.getTime()});
        if (d > now) return;
        var dp = nyParts(d);
        if (dp.y === Y) coRv[dp.m]++;
        if (d >= l30) coRvL30++;
        var credited = {};
        var tk = nameKey(r[h["technician id"]]) || (r[h.technician] ? key(r[h.technician]) : null);
        if (tk && T[tk]) credited[tk] = true;
        firsts.forEach(function (f) { if (f.re.test(text)) credited[f.k] = true; });
        Object.keys(credited).forEach(function (k) {
          if (dp.y === Y && T[k]) T[k].rvM[dp.m]++;
          if (d >= l30 && T[k]) T[k].rvL30++;
        });
      });
    }
    var cbRows = sheetRows(wb, "ST Callbacks");
    var cbRes = headerIndex(cbRows, function (r) { return String(r[0]).trim().toLowerCase() === "callback job id"; });
    if (cbRes.i >= 0 && ji >= 0) {
      auto.cb = true;
      var jobTech = {};
      var jIdCol = jh["job id"];
      jr.slice(ji + 1).forEach(function (r) { jobTech[String(r[jIdCol])] = r[jh["primary technician"]]; });
      Object.keys(T).forEach(function (k) { T[k].cbM = zeros(); T[k].cbL30 = 0; });
      cbRows.slice(cbRes.i + 1).forEach(function (r) {
        var h = cbRes.h;
        var d = toDate(r[h.created]); if (!d || d > now) return;
        if (/cancel/i.test(String(r[h.status] || ""))) return;
        var dp = nyParts(d);
        var orig = jobTech[String(r[h["original job id"]])];
        var k = orig ? key(orig) : null;
        if (dp.y === Y && k && T[k]) T[k].cbM[dp.m]++;
        if (d >= l30 && k && T[k]) T[k].cbL30++;
      });
    }

    var round = function (o) {
      Object.keys(o).forEach(function (k) {
        o[k] = Array.isArray(o[k]) ? o[k].map(function (v) { return Math.round(v * 100) / 100; }) : Math.round(o[k] * 100) / 100;
      });
    };
    Object.keys(T).forEach(function (k) {
      var t = T[k];
      t.openN = t.open.length; t.open.sort(function (a, b) { return b.a - a.a; }); t.open = t.open.slice(0, 15); t.openAmt = Math.round(t.openAmt);
      var b = board[t.k] || {};
      t.onBoard = !!board[t.k]; t.status = b.status || (board[t.k] ? "active" : "not listed");
      t.cb = cbRec[t.k] || zeros(); t.inst = instRec[t.k] || zeros();
      if (!instRec[t.k] && b.inst_mtd) t.inst[M] = b.inst_mtd;
      t.mem = {mtd:b.mem_mtd || 0, ytd:b.mem_ytd || 0}; t.rv = {mtd:b.rv_mtd || 0, ytd:b.rv_ytd || 0};
      if (auto.mem && t.memM) t.mem = {mtd:t.memM[M], ytd:t.memM.slice(0, M + 1).reduce(function (a, b) { return a + b; }, 0), m:t.memM, l30:t.memL30 || 0};
      if (auto.rv && t.rvM) t.rv = {mtd:t.rvM[M], ytd:t.rvM.slice(0, M + 1).reduce(function (a, b) { return a + b; }, 0), m:t.rvM, l30:t.rvL30 || 0};
      if (auto.cb && t.cbM) { t.cb = t.cbM; t.cbL30 = t.cbL30 || 0; }
      if (useAppt || jh["total hours worked"] != null) { t.inst = t.y.instN.slice(); t.instL30 = t.l30.instN; }
      round(t.y); round(t.l30); if (t.att) { round(t.att.y); round(t.att.l30); }
      if (t.instL30 != null) t.instL30 = Math.round(t.instL30 * 100) / 100;
    });
    round(co.y); round(co.l30);

    var wr = sheetRows(wb, "Weather"); var weather = null;
    if (wr.length) {
      var kv = kvSheet(wr);
      var wRes = headerIndex(wr, function (r) { return String(r[0]).trim().toLowerCase() === "date"; });
      var days = wRes.i < 0 ? [] : wr.slice(wRes.i + 1).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
        var d = toDate(r[0]);
        return {d: d ? nyYMD(d) : String(r[0]).trim(), c:num(r[wRes.h.code]), hi:num(r[wRes.h.hi]), lo:num(r[wRes.h.lo]), p:num(r[wRes.h.precip])};
      }).slice(0, 7);
      var up = kv.updated ? toDate(kv.updated.raw) : null;
      weather = {place:String((kv.place || {}).raw || "Norwell, MA"), t:(kv.temp || {}).v, f:(kv.feels || {}).v, c:(kv.code || {}).v, w:(kv.wind || {}).v, up: up ? up.getTime() : 0, days:days};
      if (kv.temp == null) weather = null;
    }

    var reviews = sheetRows(wb, "Reviews").slice(1).filter(function (r) { return String(r[2]).trim(); }).map(function (r) {
      return {by:String(r[1]).trim(), t:String(r[2]).trim().slice(0, 400), s:num(r[3]) || 5, d: r[4] instanceof Date ? r[4].toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric", timeZone:TZ}) : String(r[4] || "")};
    }).slice(0, 20);
    var anns = sheetRows(wb, "Announcements").slice(1).filter(function (r) { return String(r[2]).trim() && !/^💡/u.test(String(r[0])); }).map(function (r) {
      return {ic:String(r[0]).trim(), b:String(r[1]).trim(), m:String(r[2]).trim().slice(0, 240), s:String(r[3]).trim()};
    });
    var upRows = sheetRows(wb, "Board_Updates");
    var upRes = headerIndex(upRows, function (r) { return String(r[0]).trim().toLowerCase() === "posted"; });
    var updates = [];
    if (upRes.i >= 0) upRows.slice(upRes.i + 1).forEach(function (r) {
      var h = upRes.h;
      var msg = String(r[h.message] || "").trim(); if (!msg) return;
      var exp = toDate(r[h.expires]); if (exp && nyDayIndex(exp) < nyDayIndex(now)) return;
      var st = String(r[h.status] || "").toLowerCase(); if (/off|hide|done/.test(st)) return;
      var posted = toDate(r[h.posted]);
      updates.push({type:String(r[h.type] || "announcement").trim().toLowerCase(), ic:String(r[h.icon] || "").trim(), title:String(r[h.title] || "").trim().slice(0, 60), m:msg.slice(0, 240), tech:key(String(r[h.tech] || "")), at:posted ? posted.getTime() : 0});
    });
    updates.sort(function (a, b) { return b.at - a.at; });
    var leaderSums = Object.keys(board).map(function (k) { return board[k]; }).filter(function (b) { return b.status !== "inactive"; }).reduce(function (a, b) {
      ["mem_mtd","rv_mtd","mem_ytd","rv_ytd","rev_ytd","sold_ytd"].forEach(function (k) { a[k] = (a[k] || 0) + b[k]; }); return a;
    }, {});
    if (auto.mem) { leaderSums.mem_mtd = coMem[M]; leaderSums.mem_ytd = coMem.slice(0, M + 1).reduce(function (a, b) { return a + b; }, 0); leaderSums.mem_l30 = coMemL30; }
    if (auto.rv) { leaderSums.rv_mtd = coRv[M]; leaderSums.rv_ytd = coRv.slice(0, M + 1).reduce(function (a, b) { return a + b; }, 0); leaderSums.rv_l30 = coRvL30; }
    var reviewsOut = autoReviews.length ? autoReviews.sort(function (a, b) { return b.at - a.at; }).slice(0, 20).map(function (x) { return {by:x.by, t:x.t, s:x.s, d:x.d}; }) : reviews;
    auto.inst = useAppt || jh["total hours worked"] != null;
    auto.instBy = useAppt ? "appointment" : "worked";
    flags.sort(function (a, b) { return b.d.localeCompare(a.d); });
    return {v:2, builtAt: now.getTime(), auto:auto, flags:flags.slice(0, 200), dataThrough: maxDate ? nyYMD(maxDate) : "", month:M, year:Y, jobRows:jobRows, estRows:estRows,
      goals:goals, ytdGoals:ytdGoals, actuals:actuals, techs:T, co:co, reviews:reviewsOut, anns:anns, updates:updates, leaderSums:leaderSums, weather:weather};
  }

  function pick(bucket, flat, P, M, m) {
    bucket = bucket || {};
    if (P === "l30") return flat || {};
    var o = {};
    for (var i = 0; i < MK.length; i++) {
      var k = MK[i];
      o[k] = m != null ? ((bucket[k] || [])[m] || 0) : P === "mtd" ? ((bucket[k] || [])[M] || 0) : sumTo(bucket[k], M);
    }
    return o;
  }
  function derive(s) {
    s = s || {};
    return Object.assign({}, s, {
      avg: s.paid ? s.rev / s.paid : 0,
      close: s.opp ? s.conv / s.opp : 0,
      gmPct: s.rev > 0 ? s.gm / s.rev : 0,
      revHr: s.hrs > 0 ? s.rev / s.hrs : 0
    });
  }
  /* Rate metrics with nothing underneath them are "no data", not a zero. */
  var RATE_BASE = {
    avg: function (st) { return st.paid > 0; },
    close: function (st) { return st.opp > 0; },
    gmPct: function (st) { return st.rev > 0; },
    revHr: function (st) { return st.hrs > 0; },
    cbRate: function (st) { return st.jobs > 0; },
    eff: function (st) { return st.hrs > 0; },
    estClose: function (st) { return st.estN > 0; },
    avgSale: function (st) { return st.soldN > 0; },
    attend: function (st) { return st.sched > 0; },
    onTime: function (st) { return st.daysW > 0; }
  };

  function statsFor(t, P, m, ctx) {
    ctx = ctx || {};
    var now = ctx.now || nyNow();
    var snap = ctx.snap;
    var M = snap ? snap.month : nyParts(now).m;
    var s = derive(pick(t.y, t.l30, P, M, m));
    var mem = t.mem || {mtd:0, ytd:0};
    var rv = t.rv || {mtd:0, ytd:0};
    var cb = t.cb || zeros();
    var inst = t.inst || zeros();
    s.cb = m != null ? (cb[m] || 0) : P === "ytd" ? sumTo(cb, M) : P === "l30" ? (t.cbL30 != null ? t.cbL30 : (cb[M] || 0)) : (cb[M] || 0);
    s.inst = m != null ? (inst[m] || 0) : P === "ytd" ? sumTo(inst, M) : P === "l30" ? (t.instL30 != null ? t.instL30 : (inst[M] || 0)) : (inst[M] || 0);
    s.mem = m != null ? (mem.m ? mem.m[m] : (m === M ? mem.mtd : null)) : P === "ytd" ? mem.ytd : P === "l30" ? (mem.l30 != null ? mem.l30 : mem.mtd) : mem.mtd;
    s.rv = m != null ? (rv.m ? rv.m[m] : (m === M ? rv.mtd : null)) : P === "ytd" ? rv.ytd : P === "l30" ? (rv.l30 != null ? rv.l30 : rv.mtd) : rv.mtd;
    s.rating = ((ctx.techs || {})[t.k] || {}).rating || 0;
    s.openAmt = t.openAmt || 0; s.openN = t.openN || 0; s.overdue = t.overdueN || 0;
    s.cbRate = s.jobs ? s.cb / s.jobs : 0;
    s.eff = s.hrs ? (s.soldHrs || 0) / s.hrs : 0;
    s.estClose = s.estN ? s.soldN / s.estN : 0;
    s.avgSale = s.soldN ? s.sold / s.soldN : 0;
    var a = t.att;
    var pickA = function (f) {
      if (!a) return 0;
      if (m != null) return (a.y[f][m] || 0);
      if (P === "ytd") return sumTo(a.y[f], M);
      if (P === "l30") return (a.l30[f] || 0);
      return (a.y[f][M] || 0);
    };
    s.sched = pickA("sched"); s.daysW = pickA("days"); s.late = pickA("late"); s.missed = pickA("missed"); s.pto = pickA("pto"); s.clockHrs = pickA("hrs");
    s.hasAtt = !!a;
    s.attend = s.sched ? Math.max(0, (s.sched - s.missed) / s.sched) : 0;
    s.onTime = s.daysW ? Math.max(0, (s.daysW - s.late) / s.daysW) : 0;
    s.pts = Math.round((s.rev || 0) / 100 + (s.sold || 0) / 150 + (s.mem || 0) * 50 + (s.rv || 0) * 25 + (s.inst || 0) * 15);
    return s;
  }

  function coStats(P, m, ctx) {
    var snap = ctx.snap, M = snap.month;
    var s = derive(pick(snap.co.y, snap.co.l30, P, M, m));
    if (ctx.cfg.coSource === "actuals" && P === "mtd" && m == null) {
      var A = snap.actuals || {};
      if (A.rev) s.rev = A.rev.v;
      if (A.sr) s.sold = A.sr.v;
      if (A.cb) s.booked = A.cb.v;
    }
    if (P === "mtd" && m == null && !snap.jobRows) {
      var B = snap.actuals || {};
      s.rev = (B.rev || {}).v || 0;
      s.sold = (B.sr || {}).v || 0;
      s.booked = (B.cb || {}).v || 0;
    }
    return s;
  }

  function monthsElapsed(snap, now) {
    now = now || nyNow();
    var p = nyParts(now);
    var M = snap ? snap.month : p.m;
    var dim = daysInMonth(p.y, p.m);
    var frac;
    if (!snap || (p.m === M && p.y === (snap.year || p.y))) frac = p.d / dim;
    else if (p.y > (snap.year || p.y) || (p.y === (snap.year || p.y) && p.m > M)) frac = 1;
    else frac = p.d / dim;
    // Floor of one full month: January is not graded against a one-day target.
    return Math.max(1, M + frac);
  }
  function letterGrade(score) {
    if (score == null || !isFinite(score)) return null;
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }
  function scoreWith(t, P, SET, CFGM, ctx) {
    var st = statsFor(t, P, null, ctx);
    var monthsIn = P === "ytd" ? monthsElapsed(ctx.snap, ctx.now) : 1;
    var tw = 0, tot = 0, parts = {};
    var apprentice = SET === APP_METRICS;
    SET.forEach(function (m) {
      var c = (CFGM && CFGM[m.k]) || {w:m.w, target:m.target};
      var w = +c.w || 0;
      var target = +c.target;
      if (!isFinite(target)) target = m.target;
      if (m.ytdScale && P === "ytd") target *= monthsIn;
      var v = st[m.k];
      if (m.k === "rating" && !v) { parts[m.k] = {v:v, s:null, target:target}; return; }
      if (apprentice && !st.hasAtt && m.k !== "rating") { parts[m.k] = {v:v, s:null, target:target}; return; }
      if (RATE_BASE[m.k] && !RATE_BASE[m.k](st)) { parts[m.k] = {v:v, s:null, target:target}; return; }
      var s;
      if (m.inverse) s = v <= 0 ? 1 : (target > 0 ? Math.max(0, 1 - v / (2 * target)) : 0);
      else s = target > 0 ? Math.min(1, (v || 0) / target) : 0;
      parts[m.k] = {v:v, s:s, target:target};
      if (w > 0) { tw += w; tot += w * s; }
    });
    var score = tw ? Math.round(tot / tw * 100) : null;
    return {score:score, grade:letterGrade(score), parts:parts, st:st};
  }
  function roleOf(t, ctx) { return ((ctx.techs || {})[t.k] || {}).role || t.role || "tech"; }
  function scoreTech(t, P, ctx) {
    var role = roleOf(t, ctx);
    if (role === "apprentice") return scoreWith(t, P, APP_METRICS, (ctx.cfg && ctx.cfg.appMetrics) || {}, ctx);
    if (role === "sales") return scoreWith(t, P, SALES_METRICS, (ctx.cfg && ctx.cfg.salesMetrics) || {}, ctx);
    return scoreWith(t, P, METRICS, (ctx.cfg && ctx.cfg.metrics) || {}, ctx);
  }
  function roster(forBoard, which, ctx, period) {
    if (!ctx || !ctx.snap) return [];
    which = which || "tech";
    var P = forBoard ? ((ctx.cfg && ctx.cfg.boardPeriod) || "mtd") : (period || "mtd");
    return Object.keys(ctx.snap.techs || {}).map(function (k) { return ctx.snap.techs[k]; }).filter(function (t) {
      var o = (ctx.techs || {})[t.k] || {};
      if (which !== "all" && roleOf(t, ctx) !== which) return false;
      if (o.show === true) return true;
      if (o.show === false) return false;
      return (t.onBoard && t.status !== "inactive") || t.autoShow;
    }).map(function (t) {
      var meta = (ctx.techs || {})[t.k] || {};
      return Object.assign({t:t, name: meta.display || firstName(t.full)}, scoreTech(t, P, ctx));
    }).sort(function (a, b) {
      return (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score)
        || (b.st.rev || 0) - (a.st.rev || 0)
        || String(a.name).localeCompare(String(b.name));
    });
  }
  function salesRoster(forBoard, ctx, period) {
    var P = forBoard ? ((ctx.cfg && ctx.cfg.boardPeriod) || "mtd") : (period || "mtd");
    return roster(forBoard, "all", ctx, period).map(function (r) {
      var y = statsFor(r.t, "ytd", null, ctx);
      return Object.assign({}, r, {y:y, sc:scoreWith(r.t, P, SALES_METRICS, (ctx.cfg && ctx.cfg.salesMetrics) || {}, ctx), side:roleOf(r.t, ctx)});
    }).filter(function (r) { return r.y.sold > 0 || r.y.estN > 0 || r.side === "sales"; })
      .sort(function (a, b) { return b.st.sold - a.st.sold || b.y.sold - a.y.sold || String(a.name).localeCompare(String(b.name)); });
  }

  function percentToGoal(actual, goal) {
    var g = +goal || 0;
    if (!g) return null;
    return (+actual || 0) / g;
  }
  function monthPace(now) {
    var p = nyParts(now || nyNow());
    return p.d / daysInMonth(p.y, p.m);
  }
  function yearPace(now) {
    now = now || nyNow();
    var p = nyParts(now);
    var start = nyDate(p.y, 0, 1, 0, 0, 0);
    var end = nyDate(p.y + 1, 0, 1, 0, 0, 0);
    return (now - start) / (end - start);
  }
  function paceStatus(actual, goal, now) {
    var p = percentToGoal(actual, goal);
    var pace = monthPace(now);
    if (p == null) return {pct:null, pace:pace, ahead:null, behindBy:null};
    var ahead = p >= pace;
    return {pct:p, pace:pace, ahead:ahead, behindBy: ahead ? 0 : goal * pace - actual};
  }
  function periodStart(period, now) {
    now = now || nyNow();
    var p = nyParts(now);
    if (period === "ytd") return nyDate(p.y, 0, 1, 0, 0, 0);
    if (period === "l30") return addNyDays(now, -30);
    return nyDate(p.y, p.m, 1, 0, 0, 0);
  }
  function periodLabel(P) { return {mtd:"Month to date", l30:"Last 30 days", ytd:"Year to date"}[P] || ""; }
  function monthName(now) {
    return new Intl.DateTimeFormat("en-US", {timeZone:TZ, month:"long"}).format(now || nyNow());
  }
  function isStale(at, now, hours) {
    if (!at || !isFinite(+at)) return false;
    var age = (now || Date.now()) - (+at);
    var limit = (hours == null ? SETTINGS.STALE_HOURS : hours) * 3600e3;
    return age > limit;
  }
  /* Which feed the TV should use. Sheet mode is the default so a TV with no
     saved hub settings keeps reading the sheet the way it does today. */
  function chooseDataMode(opts) {
    opts = opts || {};
    var q = new URLSearchParams(opts.search || "");
    var storage = opts.storage || {};
    var settings = opts.settings || SETTINGS;
    if (q.get("mode") === "sheet" || q.get("sheet")) return "sheet";
    var url = q.get("hub") || storage["3r-hub-url"] || settings.HUB_URL || "";
    var tok = q.get("t") || storage["3r-hub-t"] || "";
    if (q.get("hub") && url && tok) return "hub";
    if ((storage["3r-data-mode"] || "") === "hub" && url && tok) return "hub";
    return "sheet";
  }
  function applySheetConfig(c) {
    c = c || {};
    var cfg = SETTINGS.defaultCfg();
    if (c.rotateSec) cfg.rotateSec = Math.min(120, Math.max(5, +c.rotateSec || 15));
    ["boardPeriod", "spotMode", "coSource"].forEach(function (k) { if (c[k]) cfg[k] = String(c[k]); });
    if (c.tvGrades !== undefined && c.tvGrades !== "") cfg.tvGrades = !/^(n|no|false|0)$/i.test(String(c.tvGrades));
    if (c.logoPlate !== undefined && c.logoPlate !== "") cfg.logoPlate = !/^(n|no|false|0)$/i.test(String(c.logoPlate));
    String(c.slidesOff || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (k) { cfg.slides[k] = false; });
    var applySet = function (set, cfgMap, wp, tp) {
      set.forEach(function (m) {
        var wKey = wp + m.k, tKey = tp + m.k;
        if (c[wKey] !== undefined && c[wKey] !== "") cfgMap[m.k].w = +c[wKey] || 0;
        if (c[tKey] !== undefined && c[tKey] !== "") {
          var n = +c[tKey];
          cfgMap[m.k].target = isFinite(n) ? n : m.target;
        }
      });
    };
    applySet(METRICS, cfg.metrics, "w_", "t_");
    applySet(APP_METRICS, cfg.appMetrics, "aw_", "at_");
    applySet(SALES_METRICS, cfg.salesMetrics, "sw_", "slt_");
    return cfg;
  }
  function parseTechMeta(rows) {
    var meta = {};
    (rows || []).slice(1).forEach(function (r) {
      var k = String(r[0] || "").trim().toLowerCase(); if (!k) return;
      meta[k] = {
        display: String(r[1] || ""),
        show: (r[2] === "" || r[2] == null) ? undefined : /^(y|yes|true|1)$/i.test(String(r[2])),
        photo: String(r[3] || ""),
        rating: +r[4] || 0,
        role: String(r[5] || "") || undefined
      };
    });
    return meta;
  }

  return {
    nyNow:nyNow, nyParts:nyParts, nyDate:nyDate, nyYMD:nyYMD, addNyDays:addNyDays, daysInMonth:daysInMonth,
    toDate:toDate, num:num, bool:bool, key:key, money:money, pct:pct, fmtM:fmtM, initials:initials, firstName:firstName, hashStr:hashStr,
    sheetRows:sheetRows, sumTo:sumTo, pick:pick, derive:derive, statsFor:statsFor, coStats:coStats,
    monthsElapsed:monthsElapsed, letterGrade:letterGrade, scoreWith:scoreWith, scoreTech:scoreTech, roleOf:roleOf,
    roster:roster, salesRoster:salesRoster, buildSnapshot:buildSnapshot,
    percentToGoal:percentToGoal, monthPace:monthPace, yearPace:yearPace, paceStatus:paceStatus, periodStart:periodStart,
    periodLabel:periodLabel, monthName:monthName, isStale:isStale, chooseDataMode:chooseDataMode,
    applySheetConfig:applySheetConfig, parseTechMeta:parseTechMeta, shiftLimitMinutes:shiftLimitMinutes
  };
});
