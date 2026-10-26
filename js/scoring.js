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
  function cleanPersonName(name) {
    return String(name || "").trim().replace(/\s+tech$/i, "").replace(/\s+/g, " ").trim();
  }
  function nameTokens(name) {
    return cleanPersonName(name).split(" ").map(function (w) {
      return w.toLowerCase().replace(/[^a-z0-9]/g, "");
    }).filter(Boolean);
  }
  /* Identity of the name as written. "Sam Rivera" and "Sam Jones" are different keys.
     A one-word name stays one word. Matching a bare first name to a full name is resolve(), not key(). */
  function key(name) { return nameTokens(name).join(""); }
  function firstToken(name) { var t = nameTokens(name); return t.length ? t[0] : ""; }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function parsePerson(name) {
    var display = cleanPersonName(name);
    if (!display || display.charAt(0) === "←") return null;
    var tokens = nameTokens(display);
    if (!tokens.length) return null;
    return { display: display, first: tokens[0], firstWord: display.split(" ")[0], key: tokens.join(""), full: tokens.length > 1 };
  }
  function createNameIndex() {
    var people = {};
    var ambiguous = [];
    var seen = {};
    function note(source, name, matches) {
      var id = source + "|" + name + "|" + matches.slice().sort().join("|");
      if (seen[id]) return;
      seen[id] = true;
      ambiguous.push({ source: source || "Name", name: name, matches: matches });
    }
    function registerFull(parsed) {
      var p = people[parsed.key];
      if (!p) people[parsed.key] = { key: parsed.key, first: parsed.first, firstWord: parsed.firstWord, full: parsed.display, isFull: true };
      else {
        p.isFull = true;
        if (parsed.display.length > p.full.length) { p.full = parsed.display; p.firstWord = parsed.firstWord; }
      }
    }
    function see(name) {
      if (SETTINGS.RULES.nameMatch === "first") return;
      var parsed = parsePerson(name);
      if (parsed && parsed.full) registerFull(parsed);
    }
    function resolve(name, source) {
      var parsed = parsePerson(name);
      if (!parsed) return null;
      if (SETTINGS.RULES.nameMatch === "first") {
        var fk = parsed.first;
        if (!people[fk]) people[fk] = { key: fk, first: fk, firstWord: parsed.firstWord, full: parsed.display, isFull: false };
        else if (parsed.display.length > people[fk].full.length) people[fk].full = parsed.display;
        return fk;
      }
      if (parsed.full) { registerFull(parsed); return parsed.key; }
      var hits = [];
      Object.keys(people).forEach(function (k) {
        var p = people[k];
        if (p.isFull && p.first === parsed.first) hits.push(p);
      });
      if (hits.length === 1) return hits[0].key;
      if (hits.length > 1) {
        note(source, parsed.display, hits.map(function (h) { return h.full; }));
        return null;
      }
      if (!people[parsed.key]) people[parsed.key] = { key: parsed.key, first: parsed.first, firstWord: parsed.firstWord, full: parsed.display, isFull: false };
      return parsed.key;
    }
    return { see: see, resolve: resolve, note: note, people: people, ambiguous: ambiguous };
  }
  function indexNames(wb, names) {
    function take(rows, headerTest, fields) {
      var res = headerIndex(rows, headerTest);
      if (res.i < 0) return;
      rows.slice(res.i + 1).forEach(function (r) {
        fields.forEach(function (f) {
          var idx = typeof f === "number" ? f : res.h[f];
          if (idx == null) return;
          names.see(r[idx]);
        });
      });
    }
    take(sheetRows(wb, "Leaderboard"), function (r) { return String(r[0]).trim().toLowerCase() === "name"; }, ["name"]);
    ["Call Back Record", "Install Record"].forEach(function (n) {
      take(sheetRows(wb, n), function (r) { return String(r[0]).trim().toLowerCase() === "tech name"; }, [0]);
    });
    take(firstRows(wb, ["ST Jobs", "Automation Jobs"]), function (r) {
      return r.some(function (c) { return String(c).trim().toLowerCase() === "primary technician"; });
    }, ["primary technician", "lead generated by"]);
    take(firstRows(wb, ["ST Estimates", "Automation Estimates"]), function (r) {
      return r.some(function (c) { return String(c).trim().toLowerCase() === "estimate status"; });
    }, ["sold by", "estimate created by"]);
    take(sheetRows(wb, "ST Techs"), function (r) { return String(r[0]).trim().toLowerCase() === "name"; }, ["name"]);
    take(sheetRows(wb, "ST Timesheets"), function (r) { return String(r[0]).trim().toLowerCase() === "employee"; }, ["employee"]);
    take(sheetRows(wb, "ST Memberships"), function (r) { return String(r[0]).trim().toLowerCase() === "membership id"; }, ["sold by"]);
    take(sheetRows(wb, "ST Reviews"), function (r) { return String(r[0]).trim().toLowerCase() === "published"; }, ["technician"]);
    take(sheetRows(wb, "Board_Updates"), function (r) { return String(r[0]).trim().toLowerCase() === "posted"; }, ["tech"]);
    var flipHead = flipHeader(sheetRows(wb, "Flips"));
    if (flipHead.i >= 0 && flipHead.tech != null) {
      sheetRows(wb, "Flips").slice(flipHead.i + 1).forEach(function (r) { names.see(r[flipHead.tech]); });
    }
  }
  /* Label on the board: the saved display name, otherwise the first name, otherwise the full name when that first name is shared. */
  function displayName(t, techs, meta) {
    if (meta && meta.display) return meta.display;
    var full = (t && t.full) || "";
    var first = firstName(full);
    if (!techs || !first) return first || full;
    var n = 0;
    Object.keys(techs).forEach(function (k) {
      if (firstName(techs[k].full).toLowerCase() === first.toLowerCase()) n++;
    });
    return n > 1 ? full : first;
  }
  /* Photo filenames are Last_First or First Last. A single name matches only when it is unique. */
  function matchTech(techs, title) {
    techs = techs || {};
    var parts = String(title || "").replace(/\.[^.]+$/, "").split(/[_\s.-]+/).filter(Boolean);
    if (!parts.length) return null;
    function direct(label) {
      var k = key(label);
      if (k && techs[k]) return techs[k].k || k;
      var found = null;
      Object.keys(techs).forEach(function (id) {
        if (key(techs[id].full) === k) found = techs[id].k || id;
      });
      return found;
    }
    var joined = direct(parts.join(" "));
    if (joined) return joined;
    if (parts.length >= 2) {
      var flip = direct(parts.slice().reverse().join(" "));
      if (flip) return flip;
    }
    function unique(pick) {
      var hits = {};
      Object.keys(techs).forEach(function (id) {
        var words = nameTokens(techs[id].full || id);
        if (!words.length) return;
        var token = pick(words);
        parts.forEach(function (p) { if (key(p) === token) hits[techs[id].k || id] = true; });
      });
      var ids = Object.keys(hits);
      return ids.length === 1 ? ids[0] : null;
    }
    return unique(function (w) { return w[0]; }) || unique(function (w) { return w[w.length - 1]; });
  }
  /* Board_Techs is often keyed by first name. Attach that row only when it matches one person. */
  function bindTechMeta(meta, techs) {
    var out = {};
    var ambiguous = [];
    var seen = {};
    Object.keys(meta || {}).forEach(function (mk) {
      var raw = String(mk || "").trim();
      if (!raw) return;
      var direct = null;
      Object.keys(techs || {}).forEach(function (k) {
        if (k === raw || k === key(raw) || key((techs[k] && techs[k].full) || "") === key(raw)) direct = k;
      });
      if (direct) { out[direct] = meta[mk]; return; }
      var first = firstToken(raw);
      var hits = [];
      Object.keys(techs || {}).forEach(function (k) {
        if (first && firstToken((techs[k] && techs[k].full) || k) === first) hits.push(k);
      });
      if (hits.length === 1) out[hits[0]] = meta[mk];
      else if (hits.length > 1) {
        var id = "Board_Techs|" + raw;
        if (!seen[id]) {
          seen[id] = true;
          ambiguous.push({ source: "Board_Techs", name: raw, matches: hits.map(function (k) { return techs[k].full; }) });
        }
      } else out[key(raw) || raw] = meta[mk];
    });
    return { meta: out, ambiguous: ambiguous };
  }
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

  function pad2(n) { return String(n).padStart(2, "0"); }
  function monthKeyFromParts(y, m) { return y + "-" + pad2(m + 1); }
  function monthKeyOf(date) {
    if (!date) return "";
    var p = nyParts(date);
    return monthKeyFromParts(p.y, p.m);
  }
  function monthKeyNow(now) {
    var p = nyParts(now || nyNow());
    return monthKeyFromParts(p.y, p.m);
  }
  function parseMonthKey(v) {
    if (v instanceof Date) return monthKeyOf(v);
    if (typeof v === "number" && isFinite(v) && v > 20000 && v < 80000) {
      var excel = toDate(v);
      return excel ? monthKeyOf(excel) : "";
    }
    var s = String(v == null ? "" : v).trim();
    if (!s) return "";
    var ym = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (ym) return ym[1] + "-" + pad2(+ym[2]);
    var my = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (my) return my[2] + "-" + pad2(+my[1]);
    var months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    var named = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (named && months[named[1].slice(0, 3).toLowerCase()]) return named[2] + "-" + pad2(months[named[1].slice(0, 3).toLowerCase()]);
    return "";
  }
  function asDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "number" && isFinite(v)) return new Date(v);
    if (typeof v === "string") {
      var d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  function dateHasTime(v) {
    if (v == null || v === "") return false;
    if (typeof v === "number" && isFinite(v)) return Math.abs(v - Math.floor(v)) > (1 / 1440);
    if (v instanceof Date) {
      var p = nyParts(v);
      return !!(p.hh || p.mm || p.ss);
    }
    return /\d{1,2}:\d{2}/.test(String(v));
  }
  function convertedFlag(v) {
    if (v === true) return true;
    if (v === false) return false;
    if (typeof v === "number") {
      if (v === 1) return true;
      if (v === 0) return false;
    }
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    if (/^(y|yes|true|1)$/i.test(s)) return true;
    if (/^(n|no|false|0)$/i.test(s)) return false;
    return null;
  }
  function normHead(s) {
    return String(s || "").trim().toLowerCase()
      .replace(/\(.*?\)/g, " ")
      .replace(/\$/g, "")
      .replace(/['’]/g, "")
      .replace(/\s*\/\s*/g, "/")
      .replace(/#/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function headerMap(row) {
    var h = {};
    (row || []).forEach(function (c, i) {
      var k = normHead(c);
      if (k && h[k] == null) h[k] = i;
    });
    return h;
  }
  function pickCol(h, names) {
    for (var i = 0; i < names.length; i++) if (h[names[i]] != null) return h[names[i]];
    return null;
  }
  function wbHas(wb, name) {
    if (!wb) return false;
    var want = String(name).trim().toLowerCase();
    if (wb.__rows) return Object.prototype.hasOwnProperty.call(wb.__rows, want);
    if (wb.SheetNames) return wb.SheetNames.some(function (n) { return String(n).trim().toLowerCase() === want; });
    return false;
  }
  /* Flips are typed by the office. Nothing on ST Jobs or ST Estimates counts as a flip. */
  function flipHeader(rows) {
    var aliases = {
      date: ["date", "posted", "when"],
      tech: ["tech", "technician", "name", "tech name"],
      customer: ["customer/job", "customer", "job", "job number", "customer/job number"],
      type: ["type", "kind"],
      converted: ["converted", "converted y/n", "won"],
      sold: ["sold", "sold amount", "amount"],
      notes: ["notes", "note"],
      month: ["month", "yyyy-mm"],
      count: ["count", "flips", "flip count", "total"]
    };
    rows = rows || [];
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var h = headerMap(rows[r]);
      var date = pickCol(h, aliases.date);
      var tech = pickCol(h, aliases.tech);
      var month = pickCol(h, aliases.month);
      var count = pickCol(h, aliases.count);
      if (tech == null) continue;
      if (date != null) {
        return {
          i: r, layout: "detail", tech: tech, date: date,
          customer: pickCol(h, aliases.customer), type: pickCol(h, aliases.type),
          converted: pickCol(h, aliases.converted), sold: pickCol(h, aliases.sold),
          notes: pickCol(h, aliases.notes)
        };
      }
      if (month != null || count != null) {
        return { i: r, layout: "summary", tech: tech, month: month, count: count };
      }
    }
    return { i: -1, layout: "none", tech: null };
  }
  function cellAt(row, idx) { return idx == null ? "" : row[idx]; }
  function readFlipEntries(rows, names) {
    rows = rows || [];
    var head = flipHeader(rows);
    var entries = [];
    if (head.i < 0) return { layout: "none", entries: entries };
    rows.slice(head.i + 1).forEach(function (r) {
      var rawName = cleanPersonName(cellAt(r, head.tech));
      if (!rawName || rawName.charAt(0) === "←" || rawName.charAt(0) === "#") return;
      if (/^(tech|technician|name|tech name)$/i.test(rawName)) return;
      var techKey = names ? names.resolve(rawName, "Flips") : key(rawName);
      var label = (techKey && names && names.people[techKey] && names.people[techKey].full) || rawName;
      if (head.layout === "summary") {
        var mk = parseMonthKey(cellAt(r, head.month));
        var count = num(cellAt(r, head.count));
        if (!mk || !(count > 0)) return;
        entries.push({
          techKey: techKey, techLabel: label, written: rawName, month: mk, count: count,
          at: null, hasTime: false, converted: null, sold: null, type: "", customer: "", notes: "", layout: "summary"
        });
        return;
      }
      var rawDate = cellAt(r, head.date);
      var at = toDate(rawDate);
      if (!at) return;
      var soldRaw = cellAt(r, head.sold);
      var soldBlank = head.sold == null || soldRaw == null || String(soldRaw).trim() === "";
      entries.push({
        techKey: techKey, techLabel: label, written: rawName, month: monthKeyOf(at), count: 1,
        at: at, hasTime: dateHasTime(rawDate), converted: convertedFlag(cellAt(r, head.converted)),
        sold: soldBlank ? null : num(soldRaw),
        type: String(cellAt(r, head.type) || "").trim(),
        customer: String(cellAt(r, head.customer) || "").trim(),
        notes: String(cellAt(r, head.notes) || "").trim(),
        layout: "detail"
      });
    });
    return { layout: head.layout, entries: entries };
  }
  function showOnValue(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (s === "slide" || s === "slides") return "slide";
    if (s === "ticker" || s === "footer") return "ticker";
    if (!s || s === "both" || s === "all") return "both";
    return "both";
  }
  function ymdOrBlank(v) {
    if (v == null || String(v).trim() === "") return "";
    var d = toDate(v);
    return d ? nyYMD(d) : "";
  }
  function readAnnouncements(rows) {
    rows = rows || [];
    if (!rows.length) return [];
    var h = headerMap(rows[0]);
    var named = h.message != null && (h["start date"] != null || h.start != null || h["end date"] != null || h.end != null || h.priority != null || h["show on"] != null || h.show != null || h.detail != null);
    var start = (h.message != null || h.icon != null || h.badge != null) ? 1 : 0;
    var out = [];
    for (var i = start; i < rows.length; i++) {
      var r = rows[i] || [];
      if (/^[💡⚠]/u.test(String(r[0] || ""))) continue;
      if (named) {
        var msg = String(cellAt(r, h.message) || "").trim();
        if (!msg || /^[💡⚠]/u.test(msg)) continue;
        var detail = h.detail != null ? String(cellAt(r, h.detail) || "").trim() : "";
        if (!detail && h.sub != null) detail = String(cellAt(r, h.sub) || "").trim();
        var pri = String(h.priority != null ? cellAt(r, h.priority) : "").trim().toLowerCase();
        out.push({
          message: msg.slice(0, 240),
          detail: detail.slice(0, 240),
          start: ymdOrBlank(h["start date"] != null ? cellAt(r, h["start date"]) : (h.start != null ? cellAt(r, h.start) : "")),
          end: ymdOrBlank(h["end date"] != null ? cellAt(r, h["end date"]) : (h.end != null ? cellAt(r, h.end) : "")),
          priority: (pri === "high" || pri === "urgent") ? "high" : "normal",
          showOn: showOnValue(h["show on"] != null ? cellAt(r, h["show on"]) : (h.show != null ? cellAt(r, h.show) : "")),
          icon: h.icon != null ? String(cellAt(r, h.icon) || "").trim() : "",
          badge: h.badge != null ? String(cellAt(r, h.badge) || "").trim() : "",
          example: false, welcome: false, legacy: false, names: null
        });
      } else {
        var msg2 = String(r[2] || "").trim();
        if (!msg2) continue;
        out.push({
          message: msg2.slice(0, 240),
          detail: String(r[3] == null ? "" : r[3]).trim().slice(0, 240),
          start: "", end: "", priority: "normal", showOn: "slide",
          icon: String(r[0] || "").trim(), badge: String(r[1] || "").trim(),
          example: false, welcome: false, legacy: true, names: null
        });
      }
    }
    return out;
  }
  function announcementActive(a, now) {
    if (!a || !String(a.message || a.m || "").trim()) return false;
    now = now || nyNow();
    var today = nyDayIndex(now);
    if (a.start) {
      var s = toDate(a.start);
      if (s && nyDayIndex(s) > today) return false;
    }
    if (a.end) {
      var e = toDate(a.end);
      if (e && nyDayIndex(e) < today) return false;
    }
    return true;
  }
  function cloneAnn(a) {
    return {
      message: a.message, detail: a.detail || "", start: a.start || "", end: a.end || "",
      priority: a.priority || "normal", showOn: a.showOn || "both", icon: a.icon || "",
      badge: a.badge || "", example: !!a.example, welcome: !!a.welcome,
      names: a.names || null, legacy: !!a.legacy
    };
  }
  function activeAnnouncements(rows, now) {
    now = now || nyNow();
    var parsed = readAnnouncements(rows);
    var base = parsed.length
      ? parsed.map(cloneAnn)
      : (SETTINGS.DEFAULT_ANNOUNCEMENTS || []).map(function (a) {
        return cloneAnn(Object.assign({ detail: "", start: "", end: "", icon: "", badge: "Example" }, a));
      });
    var welcome = SETTINGS.WELCOME_ANNOUNCEMENT;
    if (welcome) {
      var msg = String(welcome.message || "").trim().toLowerCase();
      var existing = null;
      base.forEach(function (a) {
        if (String(a.message || "").trim().toLowerCase() === msg) existing = a;
      });
      if (existing) {
        existing.welcome = true;
        existing.names = welcome.names;
        if (existing.priority !== "high") existing.priority = "high";
        if (!existing.badge) existing.badge = welcome.badge || "Welcome";
        if (!existing.icon) existing.icon = welcome.icon || "";
        if (!existing.showOn) existing.showOn = "both";
      } else if (announcementActive(welcome, now)) {
        base.unshift(cloneAnn(welcome));
      }
    }
    var high = [], rest = [];
    base.forEach(function (a) {
      if (!announcementActive(a, now)) return;
      (String(a.priority).toLowerCase() === "high" ? high : rest).push(a);
    });
    return high.concat(rest);
  }
  function announcementSlots(list) {
    var high = [], rest = [];
    (list || []).forEach(function (a) { (String(a.priority).toLowerCase() === "high" ? high : rest).push(a); });
    return high.concat(rest).concat(high);
  }
  function readContests(rows) {
    rows = rows || [];
    var headerAt = -1, h = {};
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var map = headerMap(rows[i]);
      if (map.month != null && (map.title != null || map.metric != null)) { headerAt = i; h = map; break; }
    }
    if (headerAt < 0) return [];
    function prize(r, keys) {
      for (var k = 0; k < keys.length; k++) if (h[keys[k]] != null) return String(r[h[keys[k]]] == null ? "" : r[h[keys[k]]]).trim();
      return "";
    }
    var out = [];
    rows.slice(headerAt + 1).forEach(function (r) {
      var month = parseMonthKey(r[h.month]);
      var title = String(h.title != null ? r[h.title] : "").trim();
      if (!month || !title || title.charAt(0) === "←") return;
      var whoIdx = h["whos eligible"] != null ? h["whos eligible"] : (h.eligible != null ? h.eligible : null);
      var who = whoIdx == null ? "techs" : String(r[whoIdx] == null ? "" : r[whoIdx]).trim().toLowerCase();
      var notesIdx = h["rules or notes"] != null ? h["rules or notes"] : (h.notes != null ? h.notes : (h.rules != null ? h.rules : null));
      out.push({
        month: month,
        title: title.slice(0, 80),
        metric: String(h.metric != null ? r[h.metric] : "flips").trim().toLowerCase() || "flips",
        prize1: prize(r, ["prize 1", "prize1", "1st"]),
        prize2: prize(r, ["prize 2", "prize2", "2nd"]),
        prize3: prize(r, ["prize 3", "prize3", "3rd"]),
        notes: notesIdx == null ? "" : String(r[notesIdx] == null ? "" : r[notesIdx]).trim().slice(0, 240),
        eligible: who || "techs",
        fallback: false
      });
    });
    return out;
  }
  function contestForMonth(rows, now) {
    now = now || nyNow();
    var keyNow = monthKeyNow(now);
    var list = readContests(rows);
    var found = null;
    list.forEach(function (c) { if (c.month === keyNow) found = c; });
    if (found) return found;
    if (!list.length) {
      var d = SETTINGS.DEFAULT_CONTEST;
      if (d && d.month === keyNow) return Object.assign({}, d);
    }
    return null;
  }
  function daysLeftInMonth(now) {
    var p = nyParts(now || nyNow());
    return daysInMonth(p.y, p.m) - p.d + 1;
  }
  function roleMatches(role, eligible) {
    var e = String(eligible || "all").trim().toLowerCase();
    if (e === "all" || e === "everyone" || e === "company") return true;
    if (e === "techs" || e === "tech" || e === "technicians" || e === "technician") return role === "tech";
    if (e === "sales" || e === "sale") return role === "sales";
    if (e === "apprentices" || e === "apprentice") return role === "apprentice";
    return role === "tech";
  }
  function metricValue(st, metric) {
    var k = String(metric || "").trim().toLowerCase();
    var map = {
      revenue: "rev", rev: "rev",
      sold: "sold", "sold revenue": "sold",
      memberships: "mem", membership: "mem", members: "mem",
      reviews: "rv", review: "rv",
      installs: "inst", install: "inst",
      "close rate": "close", close: "close",
      points: "pts", pts: "pts",
      jobs: "jobs",
      "avg ticket": "avg", average: "avg", avg: "avg",
      leads: "leads", lead: "leads",
      callbacks: "cb", callback: "cb",
      flips: "flips", flip: "flips"
    };
    return +((st || {})[map[k] || k]) || 0;
  }
  function entryInFlipPeriod(e, P, m, ctx) {
    var now = (ctx && ctx.now) || nyNow();
    var snap = (ctx && ctx.snap) || {};
    var p = nyParts(now);
    var year = snap.year || p.y;
    if (!e || !e.month) return false;
    var bits = String(e.month).split("-");
    var ey = +bits[0], em = +bits[1] - 1;
    if (P === "l30") {
      var at30 = asDate(e.at);
      if (!at30) return false;
      var start = addNyDays(now, -30);
      return at30 >= start && at30 <= now;
    }
    if (P === "ytd") {
      var through = m != null ? m : (snap.month != null ? snap.month : p.m);
      return ey === year && em <= through;
    }
    var month = m != null ? m : (snap.month != null ? snap.month : p.m);
    return ey === year && em === month;
  }
  function countFlips(techKey, entries, P, m, ctx, kind) {
    var n = 0;
    (entries || []).forEach(function (e) {
      if (!techKey || e.techKey !== techKey) return;
      if (!entryInFlipPeriod(e, P, m, ctx)) return;
      if (kind === "conv") { if (e.converted === true) n += e.count || 1; }
      else if (kind === "sold") { if (e.sold != null) n += e.sold; }
      else n += e.count || 1;
    });
    return n;
  }
  function sameNyDay(a, b) {
    a = asDate(a); b = asDate(b);
    return !!(a && b) && nyYMD(a) === nyYMD(b);
  }
  function weekStartNy(now) {
    var p = nyParts(now);
    var back = p.wd === 0 ? 6 : p.wd - 1;
    return nyDate(p.y, p.m, p.d - back, 0, 0, 0);
  }
  function inThisWeek(date, now) {
    date = asDate(date);
    if (!date) return false;
    var start = weekStartNy(now);
    var endP = nyParts(now);
    var end = nyDate(endP.y, endP.m, endP.d, 23, 59, 59);
    return date >= start && date <= end;
  }
  function flipBoard(snap, now, meta) {
    now = now || nyNow();
    meta = meta || {};
    var feed = (snap && snap.feed) || {};
    var entries = feed.flips || [];
    var layout = feed.flipLayout || "none";
    var keyNow = monthKeyNow(now);
    var rowsMap = {};
    entries.forEach(function (e) {
      if (e.month !== keyNow) return;
      var id = e.techKey || ("~" + String(e.written || e.techLabel || "Unknown").toLowerCase());
      var row = rowsMap[id];
      if (!row) row = rowsMap[id] = { key: e.techKey || "", name: e.techLabel || e.written || "Unknown", flips: 0, conv: 0, sold: 0, matched: !!e.techKey };
      row.flips += e.count || 1;
      if (e.converted === true) row.conv += e.count || 1;
      if (e.sold != null) row.sold += e.sold;
    });
    var rows = Object.keys(rowsMap).map(function (id) { return rowsMap[id]; });
    rows.forEach(function (r) {
      if (r.key && snap && snap.techs && snap.techs[r.key]) r.name = displayName(snap.techs[r.key], snap.techs, meta[r.key] || {});
    });
    rows.sort(function (a, b) { return b.flips - a.flips || b.sold - a.sold || String(a.name).localeCompare(String(b.name)); });
    function sum(pred, val) {
      var n = 0;
      entries.forEach(function (e) { if (pred(e)) n += val(e); });
      return n;
    }
    var company = {
      mtd: sum(function (e) { return e.month === keyNow; }, function (e) { return e.count || 1; }),
      today: sum(function (e) { return sameNyDay(e.at, now); }, function (e) { return e.count || 1; }),
      week: sum(function (e) { return inThisWeek(e.at, now); }, function (e) { return e.count || 1; }),
      conv: sum(function (e) { return e.month === keyNow && e.converted === true; }, function (e) { return e.count || 1; }),
      sold: sum(function (e) { return e.month === keyNow && e.sold != null; }, function (e) { return e.sold || 0; })
    };
    company.rate = company.mtd ? company.conv / company.mtd : 0;
    var soldKnown = layout === "detail" && entries.some(function (e) { return e.month === keyNow && e.sold != null; });
    return { layout: layout, convKnown: layout === "detail", soldKnown: soldKnown, rows: rows, company: company };
  }
  function flipAlerts(snap, now) {
    now = now || nyNow();
    var hours = +SETTINGS.FLIP_ALERT_HOURS;
    if (!isFinite(hours) || hours <= 0) hours = 6;
    var cutoff = now.getTime() - hours * 3600e3;
    var out = [];
    (((snap && snap.feed && snap.feed.flips) || [])).forEach(function (e) {
      var at = asDate(e.at);
      if (!e.hasTime || !at) return;
      var t = at.getTime();
      if (t < cutoff || t > now.getTime()) return;
      var name = e.techLabel || e.written || "A tech";
      if (e.techKey && snap.techs && snap.techs[e.techKey]) name = displayName(snap.techs[e.techKey], snap.techs, {});
      out.push({ name: name, at: t, message: "Flip alert: " + name + " just flipped a call" });
    });
    out.sort(function (a, b) { return b.at - a.at; });
    return out;
  }
  function contestStandings(contest, ctx) {
    if (!contest || !ctx || !ctx.snap) return null;
    var now = ctx.now || nyNow();
    var bits = String(contest.month || "").split("-");
    var monthIndex = (+bits[1] || 1) - 1;
    var people = Object.keys(ctx.snap.techs || {}).map(function (k) { return ctx.snap.techs[k]; }).filter(function (t) {
      if (!roleMatches(roleOf(t, ctx), contest.eligible)) return false;
      var meta = (ctx.techs || {})[t.k] || {};
      if (meta.show === false) return false;
      if (t.status === "inactive" && meta.show !== true) return false;
      return true;
    });
    var rows = people.map(function (t) {
      var st = statsFor(t, "mtd", monthIndex, ctx);
      var meta = (ctx.techs || {})[t.k] || {};
      return { key: t.k, name: displayName(t, ctx.snap.techs, meta), value: metricValue(st, contest.metric), rev: st.rev || 0 };
    });
    rows.sort(function (a, b) { return b.value - a.value || b.rev - a.rev || String(a.name).localeCompare(String(b.name)); });
    var positive = rows.filter(function (r) { return r.value > 0; });
    return {
      contest: contest,
      rows: positive.slice(0, 5),
      hasData: positive.length > 0,
      leader: positive.length ? positive[0] : null,
      daysLeft: daysLeftInMonth(now)
    };
  }
  function welcomeFaces(names, techs, meta) {
    techs = techs || {};
    meta = meta || {};
    var files = meta.photos || meta.photoFiles || [];
    return (names || []).map(function (raw) {
      var name = String(raw || "").trim();
      var want = name.toLowerCase();
      var hits = [];
      Object.keys(techs).forEach(function (id) {
        var full = (techs[id] && techs[id].full) || "";
        if (want && firstName(full).toLowerCase() === want) hits.push(techs[id].k || id);
      });
      var unique = hits.length === 1 ? hits[0] : null;
      var photo = "";
      if (unique && meta[unique] && meta[unique].photo) photo = String(meta[unique].photo);
      if (!photo && files.length) {
        var matched = [];
        files.forEach(function (f) {
          var title = (f && (f.title || f.name)) ? (f.title || f.name) : String(f || "");
          if (!title) return;
          var k = matchTech(techs, title);
          var fileHit = false;
          if (k && hits.length === 1 && k === hits[0]) fileHit = true;
          if (!fileHit && !k) {
            var parts = title.replace(/\.[^.]+$/, "").split(/[_\s.-]+/).filter(Boolean);
            if (parts.some(function (p) { return p.toLowerCase() === want; }) && parts.length <= 3 && hits.length <= 1) fileHit = true;
          }
          if (fileHit) matched.push(f);
        });
        if (matched.length === 1) {
          var one = matched[0];
          if (one && one.id) photo = "https://drive.google.com/thumbnail?id=" + one.id + "&sz=w480";
          else if (one && one.url) photo = String(one.url);
          else if (typeof one === "string") photo = one;
        }
      }
      return { name: name, key: unique || "", photo: photo };
    });
  }
  function tickerItems(snap, now) {
    now = now || nyNow();
    var out = [];
    flipAlerts(snap, now).forEach(function (a) { out.push({ type: "ticker", ic: "", title: "", m: a.message }); });
    ((snap && snap.annLive) || []).forEach(function (a) {
      if (a.showOn !== "ticker" && a.showOn !== "both") return;
      out.push({ type: "ticker", ic: a.icon || "", title: a.welcome ? "" : (a.badge || ""), m: a.message });
    });
    ((snap && snap.updates) || []).forEach(function (u) { if (u && u.type === "ticker") out.push(u); });
    return out;
  }
  function legacyAnnouncements(anns) {
    return (anns || []).filter(function (a) { return a && (a.message || a.m) && !a.welcome; }).map(function (a) {
      if (a.message) return cloneAnn(a);
      return {
        message: a.m, detail: a.s || "", start: "", end: "", priority: "normal",
        showOn: a.showOn || "slide", icon: a.ic || "", badge: a.b || "",
        example: false, welcome: false, legacy: true, names: null
      };
    });
  }
  function attachFeed(snap, wb, now, names) {
    if (!snap) return snap;
    now = now || nyNow();
    var useAnn = wbHas(wb, "Announcements");
    var useContest = wbHas(wb, "Contest");
    var useFlips = wbHas(wb, "Flips");
    if ((useAnn || useContest || useFlips) && !names) {
      names = createNameIndex();
      Object.keys(snap.techs || {}).forEach(function (k) {
        if (snap.techs[k] && snap.techs[k].full) names.see(snap.techs[k].full);
      });
      if (useFlips) {
        var seen = flipHeader(sheetRows(wb, "Flips"));
        if (seen.i >= 0 && seen.tech != null) sheetRows(wb, "Flips").slice(seen.i + 1).forEach(function (r) { names.see(r[seen.tech]); });
      }
    }
    var annLive = snap.annLive || null;
    if (useAnn) annLive = activeAnnouncements(sheetRows(wb, "Announcements"), now);
    else if (!annLive) {
      var legacy = legacyAnnouncements(snap.anns);
      if (legacy.length) {
        var welcome = SETTINGS.WELCOME_ANNOUNCEMENT;
        if (welcome && announcementActive(welcome, now) && !legacy.some(function (a) { return String(a.message).trim().toLowerCase() === String(welcome.message).trim().toLowerCase(); })) {
          legacy.unshift(cloneAnn(welcome));
        }
        annLive = legacy.filter(function (a) { return announcementActive(a, now); });
      } else annLive = activeAnnouncements([], now);
    }
    var contest = snap.contest || null;
    if (useContest) contest = contestForMonth(sheetRows(wb, "Contest"), now);
    else if (!snap.feed || !snap.feed.ready) contest = contestForMonth([], now);
    var flips = { layout: (snap.feed && snap.feed.flipLayout) || "none", entries: (snap.feed && snap.feed.flips) || [] };
    if (useFlips) flips = readFlipEntries(sheetRows(wb, "Flips"), names);
    if (snap.techs) {
      flips.entries.forEach(function (e) {
        if (!e.techKey || snap.techs[e.techKey]) return;
        snap.techs[e.techKey] = {
          k: e.techKey, full: e.techLabel, y: newBucket(), l30: newFlat(), open: [], openAmt: 0, openN: 0,
          onBoard: false, status: "not listed", role: "tech", mem: { mtd: 0, ytd: 0 }, rv: { mtd: 0, ytd: 0 }, cb: zeros(), inst: zeros()
        };
      });
    }
    snap.feed = { ready: true, flips: flips.entries, flipLayout: flips.layout };
    snap.annLive = annLive;
    snap.anns = announcementSlots(annLive);
    snap.contest = contest;
    return snap;
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
    var names = createNameIndex();
    indexNames(wb, names);

    var lbRows = sheetRows(wb, "Leaderboard");
    var lb = headerIndex(lbRows, function (r) { return String(r[0]).trim().toLowerCase() === "name"; });
    var lbi = lb.i, lbh = lb.h;
    var board = {};
    var unassignedBoard = [];
    if (lbi >= 0) lbRows.slice(lbi + 1).forEach(function (r) {
      var nm = String(r[lbh.name] == null ? "" : r[lbh.name]).trim(); if (!nm || nm.startsWith("←")) return;
      var g = function (c) { return num(r[lbh[c]]); };
      var row = {name:nm, status:String(r[lbh.status] == null ? "active" : r[lbh.status]).trim().toLowerCase() || "active",
        mem_mtd:g("mem_mtd"), rv_mtd:g("rv_mtd"), inst_mtd:g("inst_mtd"), mem_ytd:g("mem_ytd"), rv_ytd:g("rv_ytd"),
        rev_ytd:g("rev_ytd"), sold_ytd:g("sold_ytd")};
      var k = names.resolve(nm, "Leaderboard");
      if (!k) { unassignedBoard.push(row); return; }
      board[k] = row;
    });
    var rec = function (name) {
      var rows = sheetRows(wb, name);
      var i = headerIndex(rows, function (r) { return String(r[0]).trim().toLowerCase() === "tech name"; }).i;
      var o = {};
      if (i >= 0) rows.slice(i + 1).forEach(function (r) {
        var nm = String(r[0]).trim(); if (!nm) return;
        var months = []; for (var m = 1; m <= 12; m++) months.push(num(r[m]));
        var k = names.resolve(nm, name);
        if (k) o[k] = months;
      });
      return o;
    };
    var cbRec = rec("Call Back Record"), instRec = rec("Install Record");

    var T = {};
    var tech = function (nm, source) {
      var k = names.resolve(nm, source || ""); if (!k) return null;
      var label = (names.people[k] && names.people[k].full) || cleanPersonName(nm);
      if (!T[k]) T[k] = {k:k, full:label, y:newBucket(), l30:newFlat(), open:[], openAmt:0, openRows:[]};
      else if (label.length > T[k].full.length) T[k].full = label;
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
      var leadAt = SETTINGS.RULES.leadOn === "completion" ? toDate(col(r, "completion date")) : created;
      if (lead) add([tech(lead, "Lead generated by"), co], leadAt, function (o, m) { inc(o, m, "leads", 1); });
      if (status !== String(SETTINGS.RULES.revenueStatus || "completed").toLowerCase()) return;
      var d = toDate(col(r, "completion date")); if (!d) return;
      if (!maxDate || d > maxDate) maxDate = d;
      var dp = nyParts(d);
      var t = tech(col(r, "primary technician"), "ST Jobs");
      var rev = num(col(r, "jobs total revenue") || col(r, "jobs total"));
      var opp = bool(col(r, "opportunity")), conv = bool(col(r, "converted")), recall = bool(col(r, "recall"));
      var gm = num(col(r, "jobs gross margin")), hrs = num(col(r, "total hours worked"));
      var soldHrs = num(col(r, "sold hours")), warr = bool(col(r, "warranty"));
      var isInst = SETTINGS.INSTALL_REVENUE.test(String(col(r, "business unit")) + " " + String(col(r, "job type")));
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
        inc(o, m, "rev", rev); inc(o, m, "jobs", 1); if (rev > SETTINGS.RULES.paidRevenueAbove) inc(o, m, "paid", 1); if (opp) inc(o, m, "opp", 1); if (opp && conv) inc(o, m, "conv", 1);
        if (recall) inc(o, m, "recall", 1); inc(o, m, "gm", gm); inc(o, m, "hrs", hrs); inc(o, m, "soldHrs", soldHrs); if (warr) inc(o, m, "warr", 1); inc(o, m, isInst ? "instRev" : "svcRev", rev);
      });
    });

    var er = firstRows(wb, ["ST Estimates", "Automation Estimates"]);
    var ehRes = headerIndex(er, function (r) { return r.some(function (c) { return String(c).trim().toLowerCase() === "estimate status"; }); });
    var ei = ehRes.i, eh = ehRes.h;
    if (ei >= 0) er.slice(ei + 1).forEach(function (r) {
      var st = String(r[eh["estimate status"]]).trim().toLowerCase(); if (!st) return; estRows++;
      var t = tech(r[eh["sold by"]] || r[eh["estimate created by"]], "ST Estimates");
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
        var overdue = !!(fu0 && nyDayIndex(fu0) < nyDayIndex(now));
        if (overdue) t.overdueN = (t.overdueN || 0) + 1;
        var fu = fu0;
        t.open.push({n:String(r[eh["estimate name"]] || "Estimate").slice(0, 60), a:Math.round(amt), d:cd ? nyYMD(cd) : "", fu:fu ? nyYMD(fu) : ""});
        if (SETTINGS.RULES.scopeOpenPipelineToPeriod || SETTINGS.RULES.scopeOverdueToPeriod) t.openRows.push({ a: Math.round(amt), at: cd ? cd.getTime() : 0, overdue: overdue });
      }
    });
    Object.keys(board).forEach(function (k) { if (!T[k]) tech(board[k].name, "Leaderboard"); });

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
      var resolved = names.resolve(nm, "ST Techs");
      var t = (field || (active && /manager|sales/i.test(team + " " + (r[sth.positions] || "")))) ? tech(nm, "ST Techs") : (resolved ? T[resolved] : null);
      if (!t) return;
      var sells = active && /manager/i.test(team) && (t.y.sold.reduce(function (a, b) { return a + b; }, 0) + t.y.rev.reduce(function (a, b) { return a + b; }, 0)) > 0;
      t.team = team; t.stId = info.id; t.startDate = info.start; t.shift = info.shift; t.stActive = active; t.autoShow = field || sells;
      t.role = /apprentic/i.test(team) ? "apprentice" : "tech";
      if (!SETTINGS.RULES.managersWhoSellStayTechs && sells && t.role !== "apprentice") t.role = "sales";
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
      var isHoliday = SETTINGS.RULES.holidayPattern.test(code);
      if (isHoliday && SETTINGS.RULES.holidayExcusesEveryone) holidays[day] = true;
      var k = names.resolve(nm, "ST Timesheets"); if (!k || !T[k]) return;
      var p = per[k] || (per[k] = {clock:{}, pto:{}, hrs:{}, holiday:{}});
      if (isHoliday && !SETTINGS.RULES.holidayExcusesEveryone) p.holiday[day] = true;
      if (type === "ClockInOut") {
        var mins = stp.hh * 60 + stp.mm;
        if (p.clock[day] == null || mins < p.clock[day]) p.clock[day] = mins;
        p.hrs[day] = (p.hrs[day] || 0) + hrs;
      } else if (type === "PaidTimeOff" && !isHoliday) {
        p.pto[day] = (p.pto[day] || 0) + (hrs || SETTINGS.RULES.ptoDefaultHours);
      }
    });
    var todayNoon = nyDate(Y, M, pNow.d, 12, 0, 0);
    var yestNoon = addNyDays(todayNoon, -1);
    var attEnd = SETTINGS.RULES.attendanceThrough === "today" ? todayNoon : yestNoon;
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
      while (nyDayIndex(cursor) <= nyDayIndex(attEnd) && guard++ < 400) {
        var dp = nyParts(cursor);
        var k2 = ymdParts(dp);
        var dayStart = nyDate(dp.y, dp.m, dp.d, 0, 0, 0);
        var in30 = dayStart >= l30;
        var wd = SETTINGS.RULES.attendanceWeekdaysOnly ? (dp.wd >= 1 && dp.wd <= 5) : true;
        if (!(t.startDate && k2 < t.startDate)) {
          var worked = p.clock[k2] != null, ptoH = p.pto[k2] || 0, hol = !!holidays[k2] || !!(p.holiday && p.holiday[k2]);
          var addA = function (f, v) { A[f][dp.m] += v; if (in30) L[f] += v; };
          if (ptoH) addA("pto", ptoH);
          if (worked) {
            addA("days", 1); addA("hrs", p.hrs[k2] || 0);
            var late = SETTINGS.RULES.clockAtGraceIsOnTime ? p.clock[k2] > limit : p.clock[k2] >= limit;
            if (late) addA("late", 1);
          }
          if (wd && !hol) { addA("sched", 1); if (!worked && !(SETTINGS.RULES.ptoExcusesWholeDay && ptoH)) addA("missed", 1); }
        }
        cursor = addNyDays(cursor, 1);
      }
      t.att = {y:A, l30:L};
    });

    var byStId = {}; Object.keys(stById).forEach(function (id) { byStId[id] = stById[id]; });
    var nameKey = function (id) { var x = byStId[String(id)]; return x ? names.resolve(x.name, "ST Techs") : null; };
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
        if (SETTINGS.RULES.excludeMembershipRenewals && SETTINGS.RULES.renewalPattern.test(String(r[h.type] || ""))) return;
        var dp = nyParts(d);
        var k = nameKey(r[h["sold by id"]]) || names.resolve(r[h["sold by"]], "ST Memberships");
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
      var minLetters = SETTINGS.RULES.reviewNameMinLength || 3;
      var groups = {};
      Object.keys(names.people).forEach(function (id) {
        var p = names.people[id];
        var word = p.firstWord || "";
        if (word.replace(/[^A-Za-z]/g, "").length < minLetters) return;
        if (!groups[p.first]) groups[p.first] = { word: word, people: [] };
        groups[p.first].people.push(p);
      });
      var textRules = Object.keys(groups).map(function (first) {
        var g = groups[first];
        return { word: g.word, re: new RegExp("\\b" + escapeRe(g.word) + "\\b", "i"), people: g.people };
      });
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
        var tk = nameKey(r[h["technician id"]]) || (r[h.technician] ? names.resolve(r[h.technician], "ST Reviews") : null);
        if (tk && T[tk]) credited[tk] = true;
        textRules.forEach(function (f) {
          if (!f.re.test(text)) return;
          if (SETTINGS.RULES.reviewCreditUniqueFirstName && f.people.length !== 1) {
            names.note("ST Reviews", f.word, f.people.map(function (p) { return p.full; }));
            return;
          }
          f.people.forEach(function (p) { if (T[p.key]) credited[p.key] = true; });
        });
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
        var k = orig ? names.resolve(orig, "ST Callbacks") : null;
        if (dp.y === Y && k && T[k]) T[k].cbM[dp.m]++;
        if (d >= l30 && k && T[k]) T[k].cbL30++;
      });
    }

    var earlyFlips = readFlipEntries(sheetRows(wb, "Flips"), names);
    earlyFlips.entries.forEach(function (e) { if (e.techKey) tech(e.techLabel, "Flips"); });

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
    var upRows = sheetRows(wb, "Board_Updates");
    var upRes = headerIndex(upRows, function (r) { return String(r[0]).trim().toLowerCase() === "posted"; });
    var updates = [];
    if (upRes.i >= 0) upRows.slice(upRes.i + 1).forEach(function (r) {
      var h = upRes.h;
      var msg = String(r[h.message] || "").trim(); if (!msg) return;
      var exp = toDate(r[h.expires]); if (exp && nyDayIndex(exp) < nyDayIndex(now)) return;
      var st = String(r[h.status] || "").toLowerCase(); if (/off|hide|done/.test(st)) return;
      var posted = toDate(r[h.posted]);
      updates.push({type:String(r[h.type] || "announcement").trim().toLowerCase(), ic:String(r[h.icon] || "").trim(), title:String(r[h.title] || "").trim().slice(0, 60), m:msg.slice(0, 240), tech:names.resolve(String(r[h.tech] || ""), "Board_Updates") || "", at:posted ? posted.getTime() : 0});
    });
    updates.sort(function (a, b) { return b.at - a.at; });
    var leaderSums = Object.keys(board).map(function (k) { return board[k]; }).concat(unassignedBoard).filter(function (b) { return b.status !== "inactive"; }).reduce(function (a, b) {
      ["mem_mtd","rv_mtd","mem_ytd","rv_ytd","rev_ytd","sold_ytd"].forEach(function (k) { a[k] = (a[k] || 0) + b[k]; }); return a;
    }, {});
    if (auto.mem) { leaderSums.mem_mtd = coMem[M]; leaderSums.mem_ytd = coMem.slice(0, M + 1).reduce(function (a, b) { return a + b; }, 0); leaderSums.mem_l30 = coMemL30; }
    if (auto.rv) { leaderSums.rv_mtd = coRv[M]; leaderSums.rv_ytd = coRv.slice(0, M + 1).reduce(function (a, b) { return a + b; }, 0); leaderSums.rv_l30 = coRvL30; }
    var reviewsOut = autoReviews.length ? autoReviews.sort(function (a, b) { return b.at - a.at; }).slice(0, 20).map(function (x) { return {by:x.by, t:x.t, s:x.s, d:x.d}; }) : reviews;
    auto.inst = useAppt || jh["total hours worked"] != null;
    auto.instBy = useAppt ? "appointment" : "worked";
    flags.sort(function (a, b) { return b.d.localeCompare(a.d); });
    var snapOut = {v:2, builtAt: now.getTime(), auto:auto, flags:flags.slice(0, 200), dataThrough: maxDate ? nyYMD(maxDate) : "", month:M, year:Y, jobRows:jobRows, estRows:estRows,
      goals:goals, ytdGoals:ytdGoals, actuals:actuals, techs:T, co:co, reviews:reviewsOut, anns:[], annLive:null, contest:null, feed:null, updates:updates, leaderSums:leaderSums, weather:weather, ambiguous:names.ambiguous};
    return attachFeed(snapOut, wb, now, names);
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
    onTime: function (st) { return SETTINGS.RULES.onTimeDenominator === "scheduled" ? st.sched > 0 : st.daysW > 0; }
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
    if (SETTINGS.RULES.onTimeDenominator === "scheduled") s.onTime = s.sched ? Math.max(0, (s.sched - s.late) / s.sched) : 0;
    else s.onTime = s.daysW ? Math.max(0, (s.daysW - s.late) / s.daysW) : 0;
    if ((SETTINGS.RULES.scopeOpenPipelineToPeriod || SETTINGS.RULES.scopeOverdueToPeriod) && t.openRows) {
      var startAt = periodStart(P === "ytd" ? "ytd" : P === "l30" ? "l30" : "mtd", now).getTime();
      var endAt = now.getTime();
      var rows = t.openRows.filter(function (r) { return r.at >= startAt && r.at <= endAt; });
      if (SETTINGS.RULES.scopeOpenPipelineToPeriod) {
        s.openN = rows.length;
        s.openAmt = rows.reduce(function (a, r) { return a + (r.a || 0); }, 0);
      }
      if (SETTINGS.RULES.scopeOverdueToPeriod) s.overdue = rows.filter(function (r) { return r.overdue; }).length;
    }
    var feedFlips = (snap && snap.feed && snap.feed.flips) || [];
    s.flips = countFlips(t.k, feedFlips, P, m, ctx, "count");
    s.flipConv = countFlips(t.k, feedFlips, P, m, ctx, "conv");
    s.flipSold = countFlips(t.k, feedFlips, P, m, ctx, "sold");
    s.flipRate = s.flips ? s.flipConv / s.flips : 0;
    var pts = SETTINGS.RULES.points || {};
    var div = function (n, d) { return d ? (n || 0) / d : 0; };
    s.pts = Math.round(div(s.rev, pts.revenue) + div(s.sold, pts.sold) + (s.mem || 0) * (pts.membership || 0) + (s.rv || 0) * (pts.review || 0) + (s.inst || 0) * (pts.install || 0));
    return s;
  }

  function coStats(P, m, ctx) {
    var snap = ctx.snap, M = snap.month;
    var s = derive(pick(snap.co.y, snap.co.l30, P, M, m));
    var bookedKey = SETTINGS.RULES.actualsCallsBookedKey || "cb";
    if (ctx.cfg.coSource === "actuals" && P === "mtd" && m == null) {
      var A = snap.actuals || {};
      if (A.rev) s.rev = A.rev.v;
      if (A.sr) s.sold = A.sr.v;
      if (A[bookedKey]) s.booked = A[bookedKey].v;
      if (SETTINGS.RULES.actualsKeepJobRevenueSplit === false) {
        if (A.install_rev) s.instRev = A.install_rev.v;
        if (A.service_rev) s.svcRev = A.service_rev.v;
      }
    }
    if (P === "mtd" && m == null && !snap.jobRows) {
      var B = snap.actuals || {};
      s.rev = (B.rev || {}).v || 0;
      s.sold = (B.sr || {}).v || 0;
      s.booked = (B[bookedKey] || {}).v || 0;
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
    // Floor keeps a short January from becoming a one-day target. ytdMinMonths 1 is that floor.
    var floor = SETTINGS.RULES.ytdMinMonths;
    if (floor == null || !isFinite(+floor)) floor = 1;
    return Math.max(+floor, M + frac);
  }
  function letterGrade(score) {
    if (score == null || !isFinite(score)) return null;
    var grades = (SETTINGS.RULES.letterGrades || []).slice().sort(function (a, b) { return (+b.min || 0) - (+a.min || 0); });
    for (var i = 0; i < grades.length; i++) {
      if (score >= +grades[i].min) return grades[i].letter;
    }
    return "F";
  }
  function scoreWith(t, P, SET, CFGM, ctx) {
    var st = statsFor(t, P, null, ctx);
    var rules = SETTINGS.RULES;
    var monthsIn = P === "ytd" ? monthsElapsed(ctx.snap, ctx.now) : 1;
    var mtdFrac = 1;
    if (rules.prorateMtdTargets && P !== "ytd" && P !== "l30") {
      var pScale = nyParts((ctx && ctx.now) || nyNow());
      mtdFrac = pScale.d / daysInMonth(pScale.y, pScale.m);
    }
    var tw = 0, tot = 0, parts = {};
    var apprentice = SET === APP_METRICS;
    SET.forEach(function (m) {
      var c = (CFGM && CFGM[m.k]) || {w:m.w, target:m.target};
      var w = +c.w || 0;
      var target = +c.target;
      if (!isFinite(target)) target = m.target;
      if (m.ytdScale && P === "ytd") target *= monthsIn;
      else if (m.ytdScale && rules.prorateMtdTargets && P !== "l30") target *= mtdFrac;
      var v = st[m.k];
      if (m.k === "rating" && !v) { parts[m.k] = {v:v, s:null, target:target}; return; }
      if (apprentice && !st.hasAtt && m.k !== "rating") { parts[m.k] = {v:v, s:null, target:target}; return; }
      if (RATE_BASE[m.k] && !RATE_BASE[m.k](st)) { parts[m.k] = {v:v, s:null, target:target}; return; }
      var s;
      var at = rules.inverseScoreAtTarget;
      if (!isFinite(+at)) at = 0.5;
      if (m.inverse) s = v <= 0 ? 1 : (target > 0 ? Math.max(0, 1 - (v / target) * (1 - at)) : 0);
      else if (target > 0) s = rules.capScoreAtTarget === false ? ((v || 0) / target) : Math.min(1, (v || 0) / target);
      else s = 0;
      parts[m.k] = {v:v, s:s, target:target};
      if (rules.omitZeroWeight === false || w > 0) { tw += w; tot += w * s; }
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
      var role = roleOf(t, ctx);
      if (which !== "all") {
        var onTech = which === "tech" && role === "apprentice" && SETTINGS.RULES.apprenticesOnTechBoard;
        if (!onTech && role !== which) return false;
      }
      if (o.show === true) return true;
      if (o.show === false) return false;
      return (t.onBoard && t.status !== "inactive") || t.autoShow;
    }).map(function (t) {
      var meta = (ctx.techs || {})[t.k] || {};
      return Object.assign({t:t, name: displayName(t, ctx.snap.techs, meta)}, scoreTech(t, P, ctx));
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
      .sort(function (a, b) {
        if (SETTINGS.RULES.salesRankBy === "score") {
          var as = a.sc ? a.sc.score : null, bs = b.sc ? b.sc.score : null;
          return (bs == null ? -1 : bs) - (as == null ? -1 : as) || b.st.sold - a.st.sold || String(a.name).localeCompare(String(b.name));
        }
        return b.st.sold - a.st.sold || b.y.sold - a.y.sold || String(a.name).localeCompare(String(b.name));
      });
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
    var goalRaw = (c.flip_goal != null && c.flip_goal !== "") ? c.flip_goal : c.flipGoal;
    if (goalRaw != null && goalRaw !== "") {
      var fg = +goalRaw;
      if (isFinite(fg)) cfg.flipGoal = fg;
    }
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
    displayName:displayName, matchTech:matchTech, bindTechMeta:bindTechMeta,
    sheetRows:sheetRows, sumTo:sumTo, pick:pick, derive:derive, statsFor:statsFor, coStats:coStats,
    monthsElapsed:monthsElapsed, letterGrade:letterGrade, scoreWith:scoreWith, scoreTech:scoreTech, roleOf:roleOf,
    roster:roster, salesRoster:salesRoster, buildSnapshot:buildSnapshot, attachFeed:attachFeed,
    announcementActive:announcementActive, activeAnnouncements:activeAnnouncements, announcementSlots:announcementSlots,
    readAnnouncements:readAnnouncements, welcomeFaces:welcomeFaces,
    readFlipEntries:readFlipEntries, flipBoard:flipBoard, flipAlerts:flipAlerts, tickerItems:tickerItems,
    contestForMonth:contestForMonth, contestStandings:contestStandings, daysLeftInMonth:daysLeftInMonth,
    percentToGoal:percentToGoal, monthPace:monthPace, yearPace:yearPace, paceStatus:paceStatus, periodStart:periodStart,
    periodLabel:periodLabel, monthName:monthName, isStale:isStale, chooseDataMode:chooseDataMode,
    applySheetConfig:applySheetConfig, parseTechMeta:parseTechMeta, shiftLimitMinutes:shiftLimitMinutes
  };
});
