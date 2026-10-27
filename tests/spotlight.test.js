"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Sc = require("../js/scoring.js");
const Settings = require("../js/settings.js");

const OCT27 = Sc.nyDate(2026, 9, 27, 15, 0, 0);
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/team-spotlight.json"), "utf8"));
const HEAD = FIXTURE.rows[0];

function wb(sheets) {
  const rows = {};
  Object.keys(sheets).forEach(function (name) { rows[String(name).trim().toLowerCase()] = sheets[name]; });
  return { __rows: rows };
}
function at(sheets, now) {
  return Sc.buildSnapshot(wb(sheets), now || OCT27);
}
function ctx(snapshot, now, cfg) {
  return { snap: snapshot, techs: {}, cfg: cfg || Settings.defaultCfg(), now: now || OCT27 };
}
function live(rows, now, extra) {
  const s = at({ "Team Spotlight": rows }, now);
  return Sc.activeSpotlight(s.spotlight, ctx(s, now, extra && extra.cfg));
}
function names(list) {
  return list.map(function (item) { return item.name; });
}

describe("team spotlight sheet", function () {
  it("reads the fixture and skips a missing or empty tab", function () {
    const s = at({ "Team Spotlight": FIXTURE.rows, "Leaderboard": [["name", "status"], ["Sam Rivera", "active"]] });
    assert.equal(s.techs[Sc.key("Sam Rivera")].full, "Sam Rivera");
    assert.equal(s.spotlight.length, 8);
    assert.equal(at({}).spotlight.length, 0);
    assert.equal(at({ "Team Spotlight": [HEAD] }).spotlight.length, 0);
    assert.equal(at({ "Team Spotlight": [] }).spotlight.length, 0);
    const titled = at({
      "Team Spotlight": [["Notes for the office"], HEAD, ["Birthday", "Justin Rivera", "10/27/1994", "", "", "", "", "TRUE"]]
    });
    assert.equal(titled.spotlight.length, 1);
  });

  it("converts Drive share links into a thumbnail and leaves other images alone", function () {
    const id = "1iqIdyLC6tR_iZ5in0dEswGsgjMfZVRLQ";
    const thumb = "https://drive.google.com/thumbnail?id=" + id + "&sz=w480";
    assert.equal(Sc.drivePhotoUrl("https://drive.google.com/file/d/" + id + "/view?usp=sharing"), thumb);
    assert.equal(Sc.drivePhotoUrl("https://drive.google.com/open?id=" + id), thumb);
    assert.equal(Sc.drivePhotoUrl("https://drive.google.com/uc?export=view&id=" + id), thumb);
    assert.equal(Sc.drivePhotoUrl("https://drive.google.com/thumbnail?id=" + id + "&sz=w200"), thumb);
    assert.equal(Sc.drivePhotoUrl(id), thumb);
    assert.equal(Sc.drivePhotoUrl("https://example.com/jo.jpg"), "https://example.com/jo.jpg");
    assert.equal(Sc.drivePhotoUrl("data:image/png;base64,aaaa"), "data:image/png;base64,aaaa");
    assert.equal(Sc.drivePhotoUrl("javascript:alert(1)"), "");
    assert.equal(Sc.drivePhotoUrl(""), "");
    const row = at({ "Team Spotlight": FIXTURE.rows }).spotlight.filter(function (item) { return item.name === "Alex Costa"; })[0];
    assert.equal(row.photo, thumb);
  });

  it("hides Active FALSE and keeps a blank Active", function () {
    const shown = live(FIXTURE.rows);
    assert.equal(names(shown).indexOf("Casey Ng"), -1);
    assert.ok(names(shown).indexOf("Jo Parker") >= 0);
    assert.ok(names(shown).indexOf("Eric Santos") >= 0);
    const boolRow = live([
      HEAD,
      ["Shoutout", "Riley Quinn", "", "Nice work", "", "", "", false],
      ["Tech of the Month", "Alex Costa", "", "October", "", "", "", true]
    ]);
    assert.deepEqual(names(boolRow), ["Alex Costa"]);
  });

  it("uses the birthday and anniversary window, including the year change", function () {
    const justin = live(FIXTURE.rows).filter(function (item) { return item.name === "Justin Rivera"; })[0];
    assert.equal(justin.line, "HAPPY BIRTHDAY, JUSTIN!");
    assert.equal(justin.badge, "Birthday");
    assert.equal(justin.confetti, true);
    assert.equal(live(FIXTURE.rows, Sc.nyDate(2026, 9, 24, 8, 0, 0)).some(function (item) { return item.name === "Justin Rivera"; }), true);
    assert.equal(live(FIXTURE.rows, Sc.nyDate(2026, 9, 23, 23, 0, 0)).some(function (item) { return item.name === "Justin Rivera"; }), false);
    assert.equal(live(FIXTURE.rows, Sc.nyDate(2026, 9, 29, 12, 0, 0)).some(function (item) { return item.name === "Justin Rivera"; }), true);
    assert.equal(live(FIXTURE.rows, Sc.nyDate(2026, 9, 30, 0, 30, 0)).some(function (item) { return item.name === "Justin Rivera"; }), false);
    assert.equal(names(live(FIXTURE.rows)).indexOf("Pat Lee"), -1);

    const dec = [HEAD, ["Birthday", "Nora Hale", "12/31/1991", "", "", "", "", ""]];
    assert.equal(live(dec, Sc.nyDate(2026, 11, 28, 12, 0, 0)).length, 1);
    assert.equal(live(dec, Sc.nyDate(2026, 11, 27, 12, 0, 0)).length, 0);
    assert.equal(live(dec, Sc.nyDate(2027, 0, 2, 12, 0, 0)).length, 1);
    assert.equal(live(dec, Sc.nyDate(2027, 0, 3, 12, 0, 0)).length, 0);

    const jan = [HEAD, ["Birthday", "Ada Cole", "1/1", "", "", "", "", "TRUE"]];
    assert.equal(live(jan, Sc.nyDate(2026, 11, 30, 12, 0, 0))[0].line, "HAPPY BIRTHDAY, ADA!");
    assert.equal(live(jan, Sc.nyDate(2026, 11, 28, 12, 0, 0)).length, 0);
  });

  it("counts anniversary years from the hire year", function () {
    const sam = live(FIXTURE.rows).filter(function (item) { return item.name === "Sam Rivera"; })[0];
    assert.equal(sam.line, "3 YEARS WITH 3R");
    assert.equal(sam.years, 3);
    assert.equal(sam.confetti, false);
    const early = live(FIXTURE.rows, Sc.nyDate(2026, 9, 24, 12, 0, 0)).filter(function (item) { return item.name === "Sam Rivera"; })[0];
    assert.equal(early.line, "3 YEARS WITH 3R");
    const one = live([
      HEAD,
      ["Anniversary", "Nora Hale", "12/31/2022", "", "", "", "", ""]
    ], Sc.nyDate(2024, 0, 2, 12, 0, 0))[0];
    assert.equal(one.line, "1 YEAR WITH 3R");
    const noYear = live([HEAD, ["Anniversary", "Nora Hale", "10/27", "", "", "", "", ""]])[0];
    assert.equal(noYear.line, "HAPPY ANNIVERSARY, NORA!");
    const leap = live([
      HEAD,
      ["Anniversary", "Ned Moss", "2/29/2024", "", "", "", "", ""]
    ], Sc.nyDate(2027, 1, 28, 12, 0, 0))[0];
    assert.equal(leap.line, "3 YEARS WITH 3R");
    assert.equal(live([
      HEAD,
      ["Anniversary", "Ned Moss", "2/29/2024", "", "", "", "", ""]
    ], Sc.nyDate(2027, 2, 3, 12, 0, 0)).length, 0);
  });

  it("shows a new hire for 21 days from the hire date", function () {
    const rows = [HEAD, ["New Hire", "Eric Santos", "10/7/2026", "Install", "", "", "", ""]];
    assert.equal(live(rows, Sc.nyDate(2026, 9, 7, 8, 0, 0)).length, 1);
    assert.equal(live(rows, OCT27)[0].line, "WELCOME TO THE TEAM");
    assert.equal(live(rows, Sc.nyDate(2026, 9, 28, 0, 30, 0)).length, 0);
    assert.equal(live(rows, Sc.nyDate(2026, 9, 6, 12, 0, 0)).length, 0);
    const serial = (Date.UTC(2026, 9, 7) - Date.UTC(1899, 11, 30)) / 864e5;
    assert.equal(live([HEAD, ["New Hire", "Eric Santos", serial, "", "", "", "", ""]], OCT27).length, 1);
    assert.equal(live([HEAD, ["New Hire", "Eric Santos", "10/20", "", "", "", "", ""]], OCT27).length, 0);
  });

  it("keeps tech of the month and shoutouts up, unless a date window says otherwise", function () {
    const rows = [
      HEAD,
      ["Tech of the Month", "Alex Costa", "1/1/2020", "October", "", "", "", ""],
      ["Shoutout", "Jo Parker", "", "Nice save", "", "2026-10-01", "2026-10-31", "TRUE"],
      ["Birthday", "Pat Lee", "1/2/1990", "", "", "2026-10-01", "2026-10-31", ""],
      ["Birthday", "Justin Rivera", "10/27/1994", "", "", "", "2026-10-01", "TRUE"]
    ];
    const shown = live(rows);
    assert.equal(shown.filter(function (item) { return item.type === "tech"; })[0].line, "TECH OF THE MONTH");
    assert.equal(shown.filter(function (item) { return item.type === "tech"; })[0].confetti, true);
    assert.equal(shown.filter(function (item) { return item.name === "Jo Parker"; })[0].line, "Nice save");
    assert.ok(shown.some(function (item) { return item.name === "Pat Lee"; }));
    assert.equal(shown.some(function (item) { return item.name === "Justin Rivera"; }), false);
    assert.equal(live([
      HEAD,
      ["Shoutout", "Jo Parker", "", "Nice save", "", "", "2026-10-26", ""]
    ]).length, 0);
  });

  it("leaves Franco off and still shows Francisco", function () {
    const rows = FIXTURE.rows.concat([
      ["Birthday", "Francisco Rivera", "10/27/1999", "", "", "", "", "TRUE"],
      ["Shoutout", "Franco", "", "Should stay off", "", "", "", ""]
    ]);
    const shown = names(live(rows));
    assert.equal(shown.indexOf("Franco DosSantos"), -1);
    assert.equal(shown.indexOf("Franco"), -1);
    assert.ok(shown.indexOf("Francisco Rivera") >= 0);
    const open = live(rows, OCT27, { cfg: Sc.applySheetConfig({ hidden_techs: "" }) });
    assert.ok(names(open).indexOf("Franco DosSantos") >= 0);
    const roster = at({
      "ST Techs": [
        ["Name", "Team", "Active", "Start Date", "Shift Start", "Technician ID", "Positions"],
        ["Franco DosSantos", "Plumbing Service", "TRUE", "2020-01-01", "08:00", "F1", ""]
      ],
      "Team Spotlight": [HEAD, ["Shoutout", "Franco DosSantos", "", "Big job", "", "", "", ""]]
    });
    assert.equal(Sc.activeSpotlight(roster.spotlight, ctx(roster)).length, 0);
  });

  it("groups several new hires onto one slide and keeps everyone else separate", function () {
    const shown = Sc.activeSpotlight(at({ "Team Spotlight": FIXTURE.rows }).spotlight, ctx(at({ "Team Spotlight": FIXTURE.rows })));
    const deck = Sc.spotlightDeck(shown);
    const hires = deck.filter(function (slide) { return slide.kind === "hires"; });
    assert.equal(hires.length, 1);
    assert.deepEqual(names(hires[0].items), ["Eric Santos", "Maya Chen"]);
    assert.equal(deck.filter(function (slide) { return slide.kind === "one" && slide.items[0].type === "hire"; }).length, 0);
    assert.equal(deck[0].items[0].name, "Justin Rivera");
    const one = Sc.spotlightDeck(live([HEAD, ["New Hire", "Eric Santos", "10/20/2026", "", "", "", "", ""]]));
    assert.equal(one.length, 1);
    assert.equal(one[0].kind, "one");
    const order = Sc.spotlightDeck(live([
      HEAD,
      ["New Hire", "Eric Santos", "10/20/2026", "", "", "", "", ""],
      ["Birthday", "Justin Rivera", "10/27", "", "", "", "", ""],
      ["New Hire", "Maya Chen", "10/22/2026", "", "", "", "", ""]
    ]));
    assert.equal(order[0].kind, "hires");
    assert.equal(order[1].items[0].name, "Justin Rivera");
    assert.equal(order.length, 2);
  });

  it("weaves celebrations between KPI slides without dropping a KPI slide", function () {
    const kpi = ["goal", "trend", "all", "lb", "flips", "contest", "stats"].map(function (k) { return { k: k }; });
    const spots = [{ k: "celebrate", i: 0 }];
    const woven = Sc.weaveSpotlight(kpi, spots);
    assert.deepEqual(woven.filter(function (s) { return s.k !== "celebrate"; }).map(function (s) { return s.k; }), kpi.map(function (s) { return s.k; }));
    assert.equal(woven[3].k, "celebrate");
    assert.equal(woven[7].k, "celebrate");
    const many = Sc.weaveSpotlight([{ k: "goal" }, { k: "all" }], [{ k: "celebrate", i: 0 }, { k: "celebrate", i: 1 }, { k: "celebrate", i: 2 }]);
    assert.equal(many.filter(function (s) { return s.k === "goal" || s.k === "all"; }).length, 2);
    assert.equal(many.filter(function (s) { return s.k === "celebrate"; }).length, 3);
    assert.deepEqual(Sc.weaveSpotlight(kpi, []), kpi);
    assert.equal(Sc.applySheetConfig({ slidesOff: "celebrate" }).slides.celebrate, false);
    assert.equal(Settings.defaultCfg().slides.celebrate, true);
    assert.ok(Settings.SHEET_TABS.indexOf("Team Spotlight") >= 0);
  });

  it("keeps the last spotlight rows when a later fetch does not include the tab", function () {
    const s = at({ "Team Spotlight": FIXTURE.rows });
    const kept = s.spotlight.slice();
    Sc.attachFeed(s, null, OCT27);
    assert.equal(s.spotlight.length, kept.length);
    Sc.attachFeed(s, wb({ Goals: [["monthly_rev", 1]] }), OCT27);
    assert.equal(s.spotlight.length, kept.length);
    Sc.attachFeed(s, wb({ "Team Spotlight": [HEAD] }), OCT27);
    assert.equal(s.spotlight.length, 0);
    const app = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../css/board.css"), "utf8");
    assert.equal(app.includes("weaveSpotlight"), true);
    assert.equal(app.includes("CONFETTI_N = 18"), true);
    assert.equal(app.includes("requestAnimationFrame"), false);
    assert.equal(css.includes("animation-play-state:paused"), true);
    assert.equal(css.includes("@keyframes confetti-fall"), true);
  });
});
