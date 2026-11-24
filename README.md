# 3R KPI Board

Rotating KPI board for the shop TVs at 3R Plumbing and Mechanical. It loops through the monthly goal, call center, revenue trend, team scoreboard, tech leaderboard, flip tracker, monthly contest, stat sheet, tech spotlight, team celebrations, leads, year-to-date goals, Norwell weather, reviews, announcements, a ticker, and the sales board.

The site is static. GitHub Pages serves it as-is. There is no build step and nothing to compile. Shop TVs load classic scripts, not JavaScript modules.

Grading math lives in `js/scoring.js`. Targets, weights, and data-source defaults live in `js/settings.js`. The page behavior lives in `js/app.js`. Styles live in `css/board.css`.

## Data modes

ServiceTitan data reaches the board through Zapier, which writes tabs on the KPI sheet. The board only reads. It never writes to the sheet or the data hub.

Two ways to load numbers:

- **Sheet mode (the default).** The page reads the Google Sheet with the Sheets API. This is what a TV does when it opens the site with no query string, which is how the screens run today.
- **Hub mode.** The page reads a snapshot from the 3R Data Hub (an Apps Script web app). Use this when you want the TV off the Google API key.

Sheet mode stays the default on purpose. A TV that has never been given a hub address keeps working.

## Query string

| Parameter | What it does |
| --- | --- |
| `?hub=` | Data Hub `/exec` URL. Saved in the browser, then removed from the address bar. |
| `?t=` | Hub token. Saved with the hub URL. Both are required for hub mode. |
| `?key=` | Google API key for sheet mode. Saved, then removed from the address bar. Overrides the fallback key in `js/settings.js`. |
| `?sheet=` | Spreadsheet id. Forces sheet mode even if this browser previously saved a hub. |
| `?mode=sheet` | Forces sheet mode and remembers that choice. |

Hashes:

- `#board` is the rotating TV. It is also the default when the hash is empty.
- `#admin` is the scorecard and settings view. On GitHub Pages it tells you to ask Ross. Saving grades from that screen needs the editor host; the TV itself reads `Board_Config` and `Board_Techs` from the sheet.

After a TV is opened once with `?hub=` and `?t=`, reloads stay on the hub, including the nightly 3:30 AM reload. Open `?mode=sheet` to send that TV back to the sheet.

The browser remembers:

| Key | Contents |
| --- | --- |
| `3r-hub-url` | Hub URL |
| `3r-hub-t` | Hub token |
| `3r-data-mode` | `hub` or `sheet` |
| `3r-sheet-key` | API key from `?key=` |
| `3r-kpi-theme` | `dark` or `light` |
| `3r-portal-logo` | Logo images cached from the hub |
| `3r-board-cache` | Last good snapshot, so a TV can keep showing numbers while it reconnects |

## When the numbers refresh

While the page is visible it re-reads on this schedule, using the America/New_York clock: every 15 minutes from 6:00 AM through 6:59 PM, otherwise every 60 minutes. It also reloads the whole page every 6 hours, and again at about 3:30 AM New York, so a TV can stay on for weeks.

If the last successful load is more than 4 hours old, the footer shows **DATA IS STALE**. The clock and that check use New York time. Change the window in `js/settings.js` (`STALE_HOURS`).

## Sheet

Default spreadsheet id: `1iqIdyLC6tR_iZ5in0dEswGsgjMfZVRLQ9IY8pybkLOA`. Change it in `js/settings.js` (`DEFAULT_SHEET`) or pass `?sheet=`.

The sheet has to be shared so anyone with the link can view it. Tab names must match exactly. A missing tab is skipped.

`Goals`, `YTD Goals`, and `Actuals` are key/value tabs. Column A is the key, B the value, C a label, D where it came from. Reading stops at a key named `date`.

- Goals: `monthly_rev`, `memberships`, `weekly`, `install_rev`, `service_rev`
- YTD Goals: `rev_ytd`, `sold_ytd`, `mem_ytd`, `rv_ytd`
- Actuals: `rev`, `sr` (sold revenue), `cb` (calls booked, not callbacks)

`Call Center` is typed from Pivotl's weekly report, or from the phone report Pivotl uses. It is not filled from Actuals, ServiceTitan jobs, or WhatConverts. Actuals `ca` is calls answered for the month, and `cb` is calls booked. Neither one is total inbound calls. Row 1 is the instruction. Row 2 is the weekly header:

```
Week of	Booked	Bookable	Abandoned	Callbacks owed	Callbacks completed	Inbound
```

`Week of` is the Monday of that week in America/New_York. One row per week. `Booked` and `Bookable` are the calls that count in the booking rate: Booked ÷ Bookable, target 80% (`BOOKING_RATE_TARGET` in `js/settings.js`). `Inbound` on that row is every inbound call that came in that week, including booked, unbooked, and abandoned. `Abandoned` on that row is abandoned calls for the week.

Below the weekly rows, a daily section has its own header:

```
Date	Inbound	Abandoned
```

`Date` is the America/New_York day. `Inbound` is every inbound call that came in that day. `Abandoned` is abandoned calls that day. One row per day. Leave a cell blank when the report does not break the number out. A blank is not zero. The slide shows "No data" for inbound today, inbound this week, and abandoned until those cells are filled. A row for today that is blank does not fall back to yesterday.

`Callbacks owed` and `Callbacks completed` are customer callback requests from the CSR log or Pivotl, only when that report has them. They show under callback jobs when filled.

`ST Callbacks` is a different count: ServiceTitan callback jobs (`callback job id`, `created`, `status`, `original job id`). Canceled rows are skipped. The call-center slide shows how many were created this week and this month, and the week's count divided by completed jobs that week when both exist. The job's own recall flag is not this count. `Call Back Record` is the old monthly grid used for grades when `ST Callbacks` is empty. It is not the weekly call-center slide.

`Leaderboard`: `name`, `status`, `mem_mtd`, `rv_mtd`, `inst_mtd`, `mem_ytd`, `rv_ytd`, `rev_ytd`, `sold_ytd`. A status of `inactive` is left out of the leaderboard sums unless a ServiceTitan tab has replaced that number.

`Call Back Record` and `Install Record`: `Tech Name` plus one column per month. These are the fallback when the ServiceTitan tabs below are empty.

`ST Jobs` or, if that tab is empty, `Automation Jobs`:

`primary technician`, `status`, `created date`, `lead generated by`, `completion date`, `jobs total revenue` (or `jobs total`), `opportunity`, `converted`, `recall`, `jobs gross margin`, `total hours worked`, `sold hours`, `warranty`, `business unit`, `job type`, `job id`, `job #`.

Completed jobs count as revenue. Booked calls use the created date and skip canceled jobs. A `$0` completed job is not a paid job, so it does not enter average ticket. Install *revenue* is the slice of revenue whose business unit or job type matches install, replace, or new system. That is separate from the install *count* below.

`Balance` on that same tab is the unpaid-invoice slide. A row counts when it has an invoice number, it is not canceled, Empty Invoice is not true, and Balance is above zero. The slide shows the count and the dollars still due for each tech. People on the hidden-tech list, including Franco, are left off the rows. Their balances stay in the company total. The board does not need a new tab for this.

`ST Appointments`: `job id`, `appointment hours`. Hours on the same job add up.

`ST Estimates` or `Automation Estimates`:

`estimate status`, `sold by`, `estimate created by`, `estimates total`, `creation date`, `sold on`, `follow up date`, `estimate name`.

Estimates written are dated on creation. Sold dollars are dated on sold-on, or on creation when sold-on is blank. The open pipeline is everything still open, not limited to the current month. A follow-up is overdue when its New York date is before today.

`ST Techs`: `name` (a trailing "tech" is ignored), `team`, `active`, `start date` or `created on`, `shift start`, `technician id`, `positions`. A team matching plumbing, HVAC, apprentice, electric, install, service, or tech is shown automatically, unless the team also says manager, office, or part. Apprentice is a team matching "apprentic". A manager who sells stays a technician unless `Board_Techs` sets the role to sales. Part, office, and manager names are not added to the board unless they already have jobs or sold work.

`ST Timesheets`: `employee`, `start`, `employee id`, `code`, `code type` (`ClockInOut` or `PaidTimeOff`), `hours`. A code containing "holiday" excuses that New York day for everyone. Any PTO hours excuse the whole day. Blank PTO hours count as 8. Attendance runs through yesterday only, weekdays Monday–Friday, New York. Days before the tech's start date are skipped.

`ST Memberships`: `membership id`, `created`, `type` (renewals are excluded), `sold by id`, `sold by`. A sold-by id that is not on `ST Techs`, such as `16129167`, stays in the company total and is labeled Unassigned. It is not a row on the tech list.

`MP Reviews` is the review grade and the reviews slide when it has a dated row. Header:

```
Published	Platform	Rating	Author	Technician	Technician ID	Job ID	Customer	Customer ID	Verification	Job Type	Completed	Review Type	Review	Review ID
```

`Published` and `Completed` are `YYYY-MM-DD`. The technician id is matched to `ST Techs`, then the technician name, the same way other ServiceTitan names are matched. A trailing "tech" on the name is ignored. A review with no technician stays in the company total and is not given to a person. The company total also includes people on the hidden-tech list. The slide shows this month, the last 30 days, this year, and the average rating this year. The three newest reviews sit beside the company total: date, stars, the tech's first name, and a short line of text. `ST Reviews` is used only when `MP Reviews` has no dated rows.

`ST Reviews`: `published`, `rating`, `review`, `platform`, `technician id`, `technician`. A review goes on the reviews slide when the text is longer than 30 characters and the rating is 4 or higher, or blank. The slide lists this month, the last 30 days, and the year for each tech, plus the company totals and the date of the newest review. The technician id, or the full name in the technician column, credits that person. The review text credits a first name only when exactly one known person has it. A shared first name is not credited, and the admin page lists the clash. Names shorter than 3 letters are not matched in the text. A review with no technician still counts once in the company total. The hand-typed `Reviews` tab is used only when neither `MP Reviews` nor `ST Reviews` has quote rows.

The export has no customer, phone, address, or job column. For a blank technician, the board also tries the review text against `ST Jobs`, `ST Customers`, and `Install Board`. A high match is a 6-to-9 digit job number that is on `ST Jobs`, or a full customer name that is unique in the text, and a completed job for that customer finished on or before the review and no more than 30 days earlier. Install Board `Techs` are credited when that job is listed there. Otherwise the primary technician is credited. A unique last name of 6 or more letters is a lower match: it is counted on the slide note and is not added to the grade. A date by itself is not a match. `ST Appointments` has no technician names, so it cannot assign the review. A high match is included in the tech's review count and marked `matched`.

`Call Center` week-to-week is a second slide. It compares the two newest weekly rows (inbound, booked, bookable, booking rate, abandoned) and shows the daily inbound and abandoned rows that exist. It does not invent an answer rate, a handle time, a wait time, or a by-agent split. Those columns are not on the tab. Callbacks owed and completed stay off this slide while they are blank.

Tabs that were looked at and not turned into new slides: `ST Appointments` (hours are already on the install count; no technician and no arrival time), `ST Timesheets` (already the apprentice attendance grade; no job link for utilization), `ST Estimates` (close rate is already on the sales board), `ST Estimate Detail` (price and cost lines, not a new TV number), `ST Customers` (used only to join a review to a job), and `Install Board` (promised arrival window and customer notes, not an actual arrival, so it is not an on-time slide).

`ST Callbacks`: `callback job id`, `created`, `status` (canceled rows are skipped), `original job id`. The tab has no technician column. The board joins `original job id` to `ST Jobs` and credits that job's primary technician. That count is the grade. `Call Back Record` is used only when `ST Callbacks` is empty. A callback whose original job is missing from `ST Jobs` stays in the company total.

`Reviews` (typed by hand, used when neither `MP Reviews` nor `ST Reviews` has a quote): row 1 is a header, then column B by, C text, D stars, E date. This is the quote carousel. The race uses a separate tab named `Review Tracker`.

`Google Reviews` is the company Google rating. It is separate from `ST Reviews`. Row 1 is this header, and each review is one new row under it:

```
Date	Reviewer	Rating	Text	Tech	Location
```

`Date` is the day the review was published, in America/New_York (`11/17/2026` or `2026-11-17`). `Reviewer` is the public name. `Rating` is 1 through 5. `Text` is the review, and it can be blank. `Tech` is the full name when the review names someone, otherwise blank. `Location` is `Pembroke` or `Norwell`. The board averages `Rating` and counts the rows. It does not read a pre-written total, so a Zapier Google Business Profile zap should append one row per review, including older reviews if the on-screen count should match Google. Until that tab has a row with a rating, the reviews slide shows a dated public snapshot from November 17, 2026 (Pembroke 4.8 from 445, Norwell 4.6 from 11) and labels it as not a live feed.

`Announcements` still accepts the original columns, in this order: icon, badge, message, sub. A row whose first cell starts with a lightbulb is skipped. Those older rows stay full-screen slides. They do not jump onto the ticker.

The tab can also use named columns. Put this header in row 1:

```
Message	Detail	Start date	End date	Priority	Show on
```

`Detail` can also be named `SUB`. `Start date` and `End date` are optional. A blank date means "no limit". Dates are America/New_York calendar days, and the end date is included. `Priority` is `normal` or `high`. High messages are shown first and a second time each loop. `Show on` is `slide`, `ticker`, or `both`. Blank means `both`.

If the tab has no messages, the board shows five sample lines (boiler season, memberships, carbon monoxide, the on-call roster, and reviews) until someone types a real one. Samples are marked Example.

One real message is added on top of whatever is on the tab, from October 26, 2026 through November 16, 2026: "Welcome to the team, Justin and Eric!" It is high priority, on the slide and the ticker. The slide is blue, with the first names. A headshot is added only when one file in the tech photo folder matches that first name. The slide does not add a last name.

`Team Spotlight` is a separate tab. A missing tab, or a tab with no rows to show, is skipped. The rest of the board keeps rotating. Header row:

```
Type	Name	Date	Detail	Photo URL	Show From	Show Until	Active
```

`Type` is `New Hire`, `Birthday`, `Anniversary`, `Tech of the Month`, or `Shoutout`. `Date` is the event date: a birthday or anniversary month and day (`10/27` or `10/27/1994`), or a hire date (`10/20/2026`). `Detail` is a short line under the name. `Photo URL` is optional. A Google Drive share link (`https://drive.google.com/file/d/FILE_ID/view`, `open?id=`, or `uc?id=`) is turned into `https://drive.google.com/thumbnail?id=FILE_ID&sz=w480`, the same direct image the welcome slide uses. Anything else that is already an `https` image is used as-is. No photo, and no matching headshot already on the board, shows an initials circle.

`Active` blank or `TRUE` can show. `FALSE` hides the row. `Show From` and `Show Until` are optional America/New_York dates, and the end date is included. Leave both blank and the board picks the window:

| Type | When it shows |
| --- | --- |
| Birthday | From 3 days before the month and day through 2 days after it, every year. A Dec 31 birthday is still up on Jan 2. |
| Anniversary | Same month-and-day window. Years of service come from the year on `Date`, so a hire date of Oct 27, 2023 reads `3 YEARS WITH 3R` in that window in 2026. |
| New Hire | 21 days starting on `Date` (the hire date and the next 20 days). |
| Tech of the Month, Shoutout | The whole time `Active` is blank or `TRUE`. |

One slide per person: a big name, a photo or initials, a type badge, and a short line such as `HAPPY BIRTHDAY, JUSTIN!`, `WELCOME TO THE TEAM`, or `TECH OF THE MONTH`. Two or more new hires that are up together share one slide. Birthday and Tech of the Month get a small CSS confetti layer (18 pieces). It is thrown away with the slide, and it pauses while the board is paused or the page is hidden. People on the hidden-tech list, including Franco, are left off.

The slides are woven in after every few KPI slides (about every 3). Each KPI slide still stays up for the normal rotate time. `slidesOff` accepts `celebrate` to hide the section.

`Races` (or `Contest`): one row per race. Header:

```
Race	Metric	Goal	Prize	Start
```

`Metric` is `memberships`, `flips`, or `reviews`. `Start` is a New York date. The slide is titled RACE TO THE TOP and stays in the rotation from the earliest start date onward. The defaults in `js/settings.js`, used when neither tab has a race row, are three races that all start October 26, 2026 and each pay $500: first tech to 10 memberships, first tech to 10 flips, and first tech to 15 reviews. A row you type replaces the race with the same metric. The other defaults stay.

Each card shows the goal, the prize, the start date, and the top 3 techs with a bar toward the goal. The first person to reach the goal gets a WINNER banner, even when someone else later has a higher count. People on the hidden-tech list are left off.

When the hand-typed tab for a race has no rows, the board counts ServiceTitan instead. Flips come from leads (one per job). Memberships come from `ST Memberships`. A typed row on `Flips`, `Memberships`, or `Review Tracker` replaces that automatic count. The review race still uses `Review Tracker` only. ServiceTitan reviews feed the grades and the reviews slide. The Leaderboard month-to-date and year-to-date columns are not used.

The board does not create these tabs. Add them in the sheet and paste this header into row 1. It is the same header as `Flips`:

```
Date	Tech	Customer / Job #	Type	Converted	Sold $	Notes
```

| Race | Tab name |
| --- | --- |
| First to 10 flips | `Flips` |
| First to 10 memberships | `Memberships` |
| First to 15 reviews | `Review Tracker` |

`Reviews` is already the quote carousel (`#`, `REVIEWER`, `REVIEW`, `STARS`, `DATE`). Leave that tab alone. The race reads `Review Tracker`.

One row is one membership, flip, or review. `Date` can be `10/26/2026`, `10/26/2026 2:30 PM`, or `2026-10-26`. Dates are read in America/New_York. A row dated October 25 does not count. A row dated October 26 or November 2 does, including after the month changes. A row dated after today does not count yet. `Tech` should be the full name, the same way it appears on the Leaderboard tab. "Sam" counts for Sam only when he is the only Sam. "Mike" does not count for either Mike when two Mikes work here. `Type`, `Converted`, `Sold $`, and `Notes` can be left blank. `Y`, `Yes`, and `1` still count as converted on the flip tracker. `N` or `No` does not.

A shorter sheet works on any of the three tabs when there is no Date column:

```
Tech	Month	Count
```

`Month` is `YYYY-MM`. A count for October does not count in the race, because that month started before October 26. A count for November does, for the whole number in `Count`.

`Flips` is optional. When that tab has no rows, a flip is a non-canceled job with `Lead Generated By` filled in, dated on Lead Created or Created Date. Estimates with the same parent job id are the same flip, not a second one. An estimate whose parent job is not already counted is added. Canceled jobs are left out. `Bettcher Marc` matches Marc Bettcher. The bonus tracker sheet `Sales (SC-1)` can add a flip from `Flipped By (Tech)` when that job number is not already a lead. Commission columns are not read. A name the board cannot match still counts in the company flip total. A hand-typed `Flips` row replaces this automatic count.

The Flip Tracker slide ranks this month's flips, shows converted flips and the conversion rate, sold dollars, today's flips, this week's flips (Monday through today, New York), and the company total against the monthly goal. The month-only sheet has no converted flag, no dollars, and no "today" or "this week" numbers. The goal starts at 20 in `js/settings.js` (`FLIP_GOAL`). Change it without a code edit by putting `flip_goal` on the Board_Config tab. A flip dated with a clock time in the last 6 hours adds a ticker line: "Flip alert: <tech> just flipped a call". A date with no time does not.

`Weather`: key/value rows for `place`, `temp`, `feels`, `code`, `wind`, `updated`, then a table of `date`, `code`, `hi`, `lo`, `precip`. If that tab is missing, the page asks Open-Meteo for Norwell (42.1615, -70.7928).

`Board_Config`: key in column A, value in column B.

| Key | Meaning |
| --- | --- |
| `rotateSec` | Seconds per slide, clamped to 5–120 |
| `boardPeriod` | `mtd`, `l30`, or `ytd` |
| `spotMode` | `rotate` or `top` |
| `coSource` | `auto` (from jobs) or `actuals` |
| `tvGrades` | Kept for older TV links. The board no longer prints letter grades. |
| `logoPlate` | `no` turns off the white plate behind the logo |
| `slidesOff` | Comma-separated slide keys to hide: `goal`, `calls`, `calls2`, `trend`, `all`, `svcboard`, `instboard`, `bigticket`, `lb`, `unpaid`, `flips`, `mem`, `contest`, `stats`, `spot`, `leads`, `ytd`, `wx`, `rv`, `ann`, `celebrate`, `sales` |
| `flip_goal` | Company flip goal for the month. Replaces the 20 in `js/settings.js`. |
| `hidden_techs` | Comma-separated names left off individual slides, grades, the flip tracker, the races, flip alerts, and the team spotlight. Defaults to `Franco`. A blank value shows everyone again. Their jobs and dollars stay in the company, team, monthly, and goal totals. A name matches any person who has each of its words, ignoring case, so `Franco` also covers `Franco DosSantos`. |
| `w_<metric>` / `t_<metric>` | Technician weight and monthly target |
| `aw_<metric>` / `at_<metric>` | Apprentice weight and target |
| `sw_<metric>` / `slt_<metric>` | Sales weight and target |

A target of `0` is kept. Percent targets are fractions (`0.55`, not `55`). Weights do not have to add to 100. A weight of 0 leaves that metric out.

The TV does not show letter grades. A metric is green at or above its goal, yellow within about 15% of the goal, and red further away. Month-to-date counts and dollars use the same pace-adjusted goal as before. The service, install, and big-ticket slides cover Nick, Kaio, Justin, Mitch, and Bryan only. Justin is marked new and is not colored. Franco and Jon are left out of those slides and out of their team totals.

`Labor Pct` is optional. Header: `tech`, `period_start`, `period_end`, `labor_pct_revenue`, `labor_pct_sales`. Dates are `YYYY-MM-DD`. Percentages are decimals (`0.24`). One row may use `tech` = `TEAM`. The tiles show the percent and `through` the period end. A missing or empty tab hides the tiles. The sheet must not put pay dollars on this tab. Revenue labor uses the v2 bands: green at or below 19%, yellow through 25%, red above 25%. Sales labor uses green at or below 20%, yellow through 30%, red above 30%.

When `coSource` is `actuals`, month-to-date company revenue, sold revenue, and calls booked come from the Actuals tab. The install and service split on the goal slide still comes from jobs.

`Board_Techs`: key, display name, show (`yes` / `no` / blank), photo, rating (1–5), role (`tech`, `apprentice`, or `sales`). A full-name key attaches to that person. A first-name key attaches only when one person has that first name. If two people share it, the row is skipped and the admin page lists it. A blank show lets the automatic rule decide.

`Board_Updates`: `posted`, `message`, `expires`, `status` (`off`, `hide`, or `done` hides it), `type` (`ticker` scrolls the footer; anything else is a slide), `icon`, `title`, `tech`. An expiry before today in New York hides the row.

People match on the full name when the sheet has one. "Sam" attaches to Sam Rivera only when nobody else is named Sam. Mike Smith and Mike Jones stay two people. A row that only says "Mike" is left unassigned, its numbers still count in the company total, and the admin page names both Mikes. Headshots named `Last_First` still match. A file named `Mike.jpeg` does not, when two Mikes are on the roster.

`RULES` in `js/settings.js` holds the grading choices. `nameMatch` is `"full-or-unique-first"`. Set it to `"first"` to merge on first name again. The other choices, including the 50% inverse score and the letter cutoffs, are named there too and still use the same defaults.

## How grading works

Each metric scores from 0 to 100 percent of its target. Weights blend those into one score. The score is rounded to a whole number, then turned into a letter: A at 90, B at 80, C at 70, D at 60, otherwise F. If every weighted metric has nothing behind it, the score and the letter are blank and the board shows "—".

A rate with an empty denominator is left out. It is not scored as zero. That covers average ticket with no paid jobs, close rate with no opportunities, margin and revenue per hour with nothing underneath them, estimate close rate and average sale with no estimates, attendance with no scheduled days, and on-time with no clock-ins.

Lower-is-better metrics (callbacks, missed days, PTO, overdue follow-ups, callback rate) score 100% at zero and 50% at the allowed target. Twice the target scores 0%.

Month-to-date dollar and count targets scale to how much of the month has passed, with a floor of one week, so a tech who is on pace scores about 100% on that metric instead of being graded against the whole month on the 17th. Last 30 days keeps the full monthly target. Year-to-date targets scale by how much of the year has passed, using the real length of the current month, and January counts as at least one full month. Rates such as average ticket and close rate are not scaled, because they are not dollar totals.

Technicians, apprentices, and salespeople use different metric sets. Defaults, and the choices above, are named in `RULES` inside `js/settings.js`. Apprentices are graded on attendance and do not appear on the TV tech leaderboard. The sales list is ranked by dollars sold, not by the sales score.

Points on the board are not the letter grade. Points are `revenue / 100 + sold / 150 + memberships × 50 + reviews × 25 + installs × 15`, rounded.

Installs that count toward the install metric are job types matching install, replacement, conversion, full system, plumbing project, or rough and finish, over 4 hours, and not a sales visit, estimate, warranty, or inspection. Appointment hours are used when that tab exists. A job with no appointment row falls back to hours worked. Several appointments on one job add up.

The worked examples, and the rules that were left alone on purpose, are in [GRADING-REPORT.md](GRADING-REPORT.md).

## Tests

No packages to install.

```bash
npm test
```

That runs `node --test tests/scoring.test.js`. The tests build tiny in-memory workbooks, so they do not call Google or the data hub.

## API key

Sheet mode needs a Google API key. Shop TVs open this site with no query string, so a fallback key still lives in `js/settings.js` (`SHEET_KEY_FALLBACK`). It is not in `index.html` or `js/app.js`.

Restrict that key in Google Cloud to the Sheets API and to the GitHub Pages address. A TV can be moved off it by opening the page once with `?key=` (the browser remembers it) or with `?hub=` and `?t=`. Delete the fallback only after every TV has been moved. The old key is still in git history; restricting it is what protects it.
