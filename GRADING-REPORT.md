# Grading report

For Ross. This is what changed in the KPI math, what was left alone on purpose, what else moved, and what still needs a person.

The checks below are locked in `tests/scoring.test.js`. Run `npm test`.

## (a) Grading bugs that were fixed

Numbers below use the default weights and targets in `js/settings.js`.

### A rate with nothing behind it was scored as zero

Average ticket, close rate, margin, revenue per hour, estimate close rate, average sale, attendance, and on-time used to become 0% when the denominator was 0. The TV already printed "—" for some of those, then the grade still punished the person.

**$40,000 revenue, 1 paid job, 0 opportunities.** Close rate is 20% of a technician's grade.

| | Score | Grade |
| --- | --- | --- |
| Before | 58 | F |
| After | 73 | C |

Close rate is left out. Average ticket still counts, because there was a paid job.

**A technician with no jobs.** Average ticket and close rate are both left out. Revenue of $0 still counts.

| | Score | Grade |
| --- | --- | --- |
| Before | 16 | F |
| After | 25 | F |

**A salesperson with no estimates.** Estimate close rate and average sale are left out.

| | Score |
| --- | --- |
| Before | 11 |
| After | 17 |

**An apprentice with no clock-ins, no PTO, and no manager rating.**

| | Score | Grade |
| --- | --- | --- |
| Before | 0 | F |
| After | blank | blank |

The board shows "—" rather than an F.

### Year-to-date targets used a 31-day month

The old scale was `month index + day of month / 31`. February 28 was treated as 1.903 months.

| | Revenue target on Feb 28 |
| --- | --- |
| Before | $76,129 |
| After | $80,000 |

February 28 is exactly 2 months of a $40,000 monthly target (1 + 28/28). October 26 does not move: 9 + 26/31, about $393,548. January is still at least one full month, so a January 1 snapshot is not graded against a one-day target.

### "Last 30 days" was not 30 days

Memberships and reviews, when the day of the month was under 30, added the entire previous month plus the current month. On October 26, memberships sold Sept 1, Sept 27, and Oct 2:

| | Last 30 days | This month | Year to date |
| --- | --- | --- | --- |
| Before | 3 | 1 | 3 |
| After | 2 | 1 | 3 |

Sept 1 is outside the 30 days. The same window is now used for callbacks and installs when the ServiceTitan tabs have a date on each row. Those two used to ignore the daily rows and show this month's count only.

A Leaderboard or Call Back Record tab with one number per month still has no daily history. "Last 30 days" for those stays the month-to-date number.

### Appointment hours were overwritten

Two appointments of 3 hours on the same job were stored as 3, because the second row replaced the first. A missing appointment was also treated as 0 hours, so a long install with no appointment row did not count.

Hours on one job now add up. A job with no appointment row falls back to Total Hours Worked. A recorded 0 stays 0 and does not fall back. A 6-hour "Water Heater Install" with two 3-hour appointments counts. A 5-hour service call is flagged, not counted. A warranty install is flagged, not counted.

### Dates used the wrong clock

The old page used the TV's local timezone, and several date strings were read as UTC.

- A job finished at 11:00 PM in New York could be stored as the next day.
- `2026-10-26` with no time was UTC midnight, which is the previous evening in New York.
- Excel serials used today's daylight-saving offset, so a winter date read in the summer (or the reverse) could shift by an hour.
- `2:30 PM` was read as 2:30 in the morning.
- A follow-up due today became overdue after midnight.
- An instant at 12:30 AM UTC on March 1 is still February 28 in New York. Revenue from that job now lands in February.

Period math, the clock, the pace line, attendance, the nightly reload, and the pull schedule all use America/New_York. A follow-up is overdue only when its New York date is before today.

### Other scoring and data bugs

- **Hub mode was forgotten on reload.** The page stripped `?hub=` from the address and the next load, including 3:30 AM, went back to the sheet. The browser now remembers hub mode.
- **The estimate tab was requested under the wrong name.** The sheet call asked for ` Automation Estimates` with a leading space, so that tab never loaded. `ST Appointments`, `ST Memberships`, `ST Reviews`, and `ST Callbacks` were not requested at all. They are requested now. If those tabs have rows, they replace the hand-typed Leaderboard and record-tab numbers, and grades can move. That is intended.
- **Yes and 1 were not true.** Opportunity, Converted, Recall, and Warranty only counted for the exact value `true`. `Yes` counts now.
- **A sold estimate with a blank sold-on date was dropped.** It counts on the day it was written.
- **PTO with no clock-ins was ignored.** That apprentice was left unscored. PTO is attendance now. Someone with neither clock-ins nor PTO is still unscored.
- **A midnight shift was read as 8:00 AM.** `00:00` is midnight. A blank shift is still 8:00 AM. Grace is 10 minutes. 8:10 is on time. 8:11 is late.
- **Ties depended on insertion order.** Equal scores now sort by revenue, then by name.
- **A revenue goal of $0 showed 0% and "behind pace".** It now says the monthly goal is not set and prints "—".

## Names

Ross asked to stop merging people who share a first name.

**Before.** Mike Smith ($100, one opportunity) and Mike Jones ($250) became one row, `mike`, with $350. A review that said "Mike" credited every Mike. A Leaderboard row that said "Mike" was added on top of that same row.

**After.** They stay two people. Mike Smith keeps the $100 and the opportunity. Mike Jones keeps the $250. A Leaderboard row or a shout-out that only says "Mike" is not given to either of them. The admin page, including the view that says to ask Ross, lists it: Leaderboard, "Mike" matches Mike Jones and Mike Smith. The membership dollars on that unassigned row still count in the company total. A bare "Sam" still attaches to Sam Rivera when Sam is the only Sam. Review text credits "Ann" when Ann is the only Ann. It does not credit "Mike" when an office Mike and a field Mike both exist. The technician id, or the full name in the technician column, still credits that one person. "Al" is still too short to match inside review text. A headshot named `Rivera_Sam.jpeg` still matches Sam Rivera. `Mike.jpeg` does not, when two Mikes are on the roster. A `Board_Techs` row keyed `mike` is flagged the same way and is not applied to both.

`RULES.nameMatch` in `js/settings.js` is `"full-or-unique-first"`. Set it to `"first"` to merge on first name again.

## (b) Rules that were not changed

These stay at the same values. Each one is a named setting in `js/settings.js` (`RULES`, or the install patterns next to it) so a later change does not mean a hunt through the math.

- `inverseScoreAtTarget` is 0.5. Lower-is-better metrics score 100% at zero and 50% at the allowed target. Callbacks allowed at 2 per month: 0 callbacks scores 100%, 2 scores 50%, 4 scores 0%.
- `ytdMinMonths` is 1. January year-to-date is at least one full month.
- `prorateMtdTargets` is false. Month-to-date targets are the full month. They are not cut down because the month is only partly over. Pace on the goal slide is separate from the grade.
- `letterGrades` stay A 90, B 80, C 70, D 60.
- `salesRankBy` is `"sold"`. The sales board is ranked by dollars sold, not by the sales score.
- `apprenticesOnTechBoard` is false. Apprentices show on the apprentice table, not on the TV tech leaderboard.
- `paidRevenueAbove` is 0. A `$0` job is not a paid job, so it stays out of average ticket.
- Install *count* and install *revenue* use different rules. Count uses `INSTALL_TYPE` and `NOT_INSTALL` (install, replacement, conversion, full system, plumbing project, rough and finish; not sales, estimate, warranty, or inspection) and `INSTALL_HOURS` (4). Revenue split uses `INSTALL_REVENUE` (install, replace, or new system on the business unit or job type).
- `leadOn` is `"created"`. Leads use the job's created date. `revenueStatus` is `"completed"`.
- `scopeOpenPipelineToPeriod` and `scopeOverdueToPeriod` are false. The open pipeline and overdue follow-ups are not limited to the selected month.
- `excludeMembershipRenewals` is true (`renewalPattern`).
- `reviewNameMinLength` is 3. One- and two-letter names are not matched in review text. The company total still counts each review once. Who gets credit from the text is the name rule above (`reviewCreditUniqueFirstName`).
- `ptoExcusesWholeDay` is true and `ptoDefaultHours` is 8. `holidayPattern` matches "holiday". `holidayExcusesEveryone` is true, so one employee's holiday code excuses that day for the company.
- `attendanceThrough` is `"yesterday"`. Today is not a missed day yet. `attendanceWeekdaysOnly` is true.
- `onTimeDenominator` is `"daysClockedIn"`. On-time uses days the person clocked in, including a weekend they worked. A weekend with no clock-in is not a missed day.
- `clockAtGraceIsOnTime` is true. Grace is `GRACE_MIN`, 10 minutes. Clocking in exactly at shift start plus 10 minutes is on time.
- Zero hours clocked is a real zero, including early in the month.
- A manager rating of 0, or a blank rating, is left out. It is not a zero score.
- `points` are `revenue/100 + sold/150 + memberships×50 + reviews×25 + installs×15`. Points are not the letter grade.
- `actualsCallsBookedKey` is `"cb"`. On the Actuals tab that means calls booked, not callbacks.
- `managersWhoSellStayTechs` is true. A manager who sells stays a technician unless `Board_Techs` says sales.
- Part, office, and manager names are not added to the board automatically (`FIELD_TEAM`).
- An inactive Leaderboard status is separate from the ServiceTitan active flag.
- `capScoreAtTarget` is true. Estimates written and estimates sold can fall in different months, so a month's close rate can be over 100%. The grade caps that metric at 100%.
- `omitZeroWeight` is true. A weight of 0 leaves the metric out of the grade.
- `actualsKeepJobRevenueSplit` is true. `coSource = actuals` (a `Board_Config` key) replaces month-to-date company revenue, sold revenue, and calls booked. The install/service split stays job-based.
- Hand-typed membership and review numbers have no daily history, so "last 30 days" for those stays the month-to-date figure.

## (c) Other fixes

- The single `index.html` is split into `index.html`, `css/board.css`, `js/settings.js`, `js/scoring.js`, and `js/app.js`. No build step. The look of the board is the same, aside from the stale flag and "—" where a grade used to be a false F or a rate used to be 0%.
- Targets, weights, the sheet id, the tab list, and the fallback API key are in `js/settings.js`.
- The footer shows **DATA IS STALE** when the last good load is more than 4 hours old. Admin shows the same note.
- `?mode=sheet` and `?sheet=` force the sheet, so a saved hub address cannot trap a TV. A saved hub is used again after a reload.
- `Board_Config` keys for apprentice weights (`aw_`, `at_`) and sales weights (`sw_`, `slt_`) are applied. A target of 0 sticks. Slide time is clamped to 5–120 seconds.
- Missing reviews, announcements, or tech rows no longer take the rotation down.
- The clock, the 3:30 AM reload, and the 6 AM–7 PM pull window use New York time.
- The leaderboard prints "—" when a person has no score, instead of the word "null".
- Admin lists first names that match more than one person, including on the public page that tells a viewer to ask Ross. The rotating TV does not show that list.
- An empty weather forecast no longer runs a min/max over no days, so a blank forecast does not invent a freeze or heat alert.

## (d) What Ross needs to do

1. **Restrict the Google API key** in Google Cloud: Sheets API only, and HTTP referrers limited to the GitHub Pages address. The fallback key is still in `js/settings.js` because the TVs open the site with no query string. It is also still in git history. Restricting it is what protects it. Do not delete the fallback until step 2 is done for every TV.
2. **Move each TV** when you are ready. Open it once with `?hub=<data hub URL>&t=<token>`, or once with `?key=<a key you control>`. The page saves that and strips it from the address. Reloads, including 3:30 AM, keep the choice. Open `?mode=sheet` to send a TV back to the sheet. After this deploy, a TV picks up the new files on its next reload (within 6 hours, or at 3:30 AM New York). A manual refresh is faster.
3. **Do not rewrite git history.** The old key stays in older commits. The ServiceTitan credentials that used to live in the deleted Netlify function are still in history too. Keep rotating that secret. Do not put it back in the repo.
4. **The first-name merge is already changed.** Mike Smith and Mike Jones stay separate. Anything that only says "Mike" shows on the admin page instead of being combined. The other rules in section (b) are named settings in `js/settings.js` and were left at the same values, including the 50%-at-target inverse score and the letter cutoffs. Change a value there if you want a different rule.
5. **Confirm the Opportunity column is filled in** on the jobs tab. If it is blank, close rate drops out of everyone's grade instead of scoring as 0%. That raises grades for anyone who had no opportunities marked. The $40,000 example above is that case: F becomes C.
6. **Share the Zapier tabs** "anyone with the link can view" if they are not already. Sheet mode now reads `ST Appointments`, `ST Memberships`, `ST Reviews`, `ST Callbacks`, and `Automation Estimates`. When those tabs have rows, they replace the hand-typed membership, review, callback, and install numbers.
