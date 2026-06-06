// ════════════════════════════════════════════════════════════════
// 3R Plumbing — ServiceTitan KPI Proxy Function
// Netlify serverless function — no header size limits
// Called by Google Apps Script every hour
// ════════════════════════════════════════════════════════════════

const TENANT   = '2383607358';
const CLIENT   = 'cid.bz2mi9d9qxq6nsu53bvf320hp';
const SECRET   = 'cs1.ynusayzezxqp7139dcrgp865gbmparjuqe2n60h2ov1ghvwuuh';
const BASE     = 'https://api.servicetitan.io';
const AUTH_URL = 'https://auth.servicetitan.io/connect/token';

// ── MAIN HANDLER ─────────────────────────────────────────────────
export async function handler(event) {
  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods':'GET,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    console.log('🔄 Getting ServiceTitan token...');
    const token = await getToken();
    console.log('✅ Token obtained');

    const now      = new Date();
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const ytdStart = new Date(now.getFullYear(), 0, 1).toISOString();
    const end      = now.toISOString();

    console.log('📡 Pulling ServiceTitan data...');

    // Pull MTD and YTD data in parallel
    const [jobs, calls, mems, ests, ytdJobs, ytdMems, ytdEsts] = await Promise.all([
      getAll(token, `/jpm/v2/tenant/${TENANT}/jobs`,        { completedOnOrAfter: mtdStart, completedBefore: end }),
      getAll(token, `/crm/v2/tenant/${TENANT}/calls`,       { createdOnOrAfter: mtdStart, createdBefore: end }),
      getAll(token, `/memberships/v2/tenant/${TENANT}/memberships`, { soldAfter: mtdStart, soldBefore: end }),
      getAll(token, `/jpm/v2/tenant/${TENANT}/estimates`,   { createdOnOrAfter: mtdStart, createdBefore: end }),
      getAll(token, `/jpm/v2/tenant/${TENANT}/jobs`,        { completedOnOrAfter: ytdStart, completedBefore: end }),
      getAll(token, `/memberships/v2/tenant/${TENANT}/memberships`, { soldAfter: ytdStart, soldBefore: end }),
      getAll(token, `/jpm/v2/tenant/${TENANT}/estimates`,   { createdOnOrAfter: ytdStart, createdBefore: end }),
    ]);

    console.log(`📊 MTD — Jobs: ${jobs.length} | Calls: ${calls.length} | Mems: ${mems.length}`);
    console.log(`📊 YTD — Jobs: ${ytdJobs.length} | Mems: ${ytdMems.length}`);

    const kpis = buildKPIs(jobs, calls, mems, ests, ytdJobs, ytdMems, ytdEsts);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, timestamp: now.toISOString(), kpis }),
    };

  } catch (err) {
    console.error('❌ Error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}

// ── AUTH ─────────────────────────────────────────────────────────
async function getToken() {
  const res = await fetch(AUTH_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT,
      client_secret: SECRET,
    }),
  });
  if (!res.ok) throw new Error('Auth failed: ' + res.status);
  const data = await res.json();
  if (!data.access_token) throw new Error('No token in response');
  return data.access_token;
}

// ── API HELPER ────────────────────────────────────────────────────
async function apiGet(token, endpoint, params) {
  const url = BASE + endpoint + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'ST-App-Key':    CLIENT,
      'Content-Type':  'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status} on ${endpoint}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

// Paginate through all results
async function getAll(token, endpoint, params, maxPages = 10) {
  const results = [];
  let page = 1;
  while (page <= maxPages) {
    const data = await apiGet(token, endpoint, { ...params, page, pageSize: 500 });
    if (!data?.data?.length) break;
    results.push(...data.data);
    if (!data.hasMore) break;
    page++;
  }
  return results;
}

// ── KPI CALCULATIONS ──────────────────────────────────────────────
function buildKPIs(jobs, calls, mems, ests, ytdJobs, ytdMems, ytdEsts) {
  // Filter completed jobs
  const completed = jobs.filter(j => j.status === 'Completed');
  const installs  = completed.filter(j => isInstall(j));
  const callbacks = completed.filter(j => isCallback(j));

  // MTD actuals
  const rev  = sumRev(completed);
  const ir   = sumRev(installs);
  const cr   = completed.length;
  const ic   = installs.length;
  const bk   = calls.filter(c => (c.reason || c.status || '').toLowerCase().includes('book')).length;
  const ca   = calls.length;
  const br   = ca > 0 ? Math.round((bk / ca) * 100) : 0;
  const at   = cr > 0 ? Math.round(rev / cr) : 0;
  const ms   = mems.length;
  const cbk  = callbacks.length;
  const sr   = sumSold(ests);

  // Install close rate
  const instEsts     = ests.filter(e => isInstall(e));
  const soldInstEsts = instEsts.filter(e => e.status === 'Sold');
  const cls = instEsts.length > 0 ? Math.round((soldInstEsts.length / instEsts.length) * 100) : 0;

  // Active techs count
  const techSet = new Set();
  completed.forEach(j => (j.assignments || []).forEach(a => {
    if (a.technician?.name) techSet.add(a.technician.name);
  }));
  const rpt = techSet.size > 0 ? Math.round(rev / techSet.size) : 0;

  // YTD
  const ytdCompleted = ytdJobs.filter(j => j.status === 'Completed');
  const revYtd       = sumRev(ytdCompleted);
  const memYtd       = ytdMems.length;
  const soldYtd      = sumSold(ytdEsts);

  // Tech leaderboard MTD
  const techMap = {};
  completed.forEach(j => {
    (j.assignments || []).forEach(a => {
      const name = a.technician?.name;
      if (!name) return;
      if (!techMap[name]) techMap[name] = { name, rev_mtd: 0, sold_mtd: 0, mem_mtd: 0, rv_mtd: 0, inst_mtd: 0 };
      techMap[name].rev_mtd  += j.total || j.invoice?.total || 0;
      if (isInstall(j)) techMap[name].inst_mtd++;
    });
  });
  ests.filter(e => e.status === 'Sold').forEach(e => {
    const name = e.technician?.name || e.soldBy?.name;
    if (!name || !techMap[name]) return;
    techMap[name].sold_mtd += e.total || 0;
  });
  mems.forEach(m => {
    const name = m.soldBy?.name || m.technician?.name;
    if (!name || !techMap[name]) return;
    techMap[name].mem_mtd++;
  });

  // Round numbers
  const techs = Object.values(techMap).map(t => ({
    ...t,
    rev_mtd:  Math.round(t.rev_mtd),
    sold_mtd: Math.round(t.sold_mtd),
  }));

  return {
    actuals: { rev, ir, cr, ic, bk, ca, br, at, ms, bk_count: cbk, sr, rpt, cls },
    ytd:     { rev: revYtd, mem: memYtd, sold: soldYtd },
    techs,
  };
}

function sumRev(jobs) {
  return Math.round(jobs.reduce((s, j) => s + (j.total || j.invoice?.total || j.revenue || 0), 0));
}
function sumSold(ests) {
  return Math.round(ests.filter(e => e.status === 'Sold').reduce((s, e) => s + (e.total || 0), 0));
}
function isInstall(j) {
  const t = (j.jobType?.name || j.type || '').toLowerCase();
  return t.includes('install') || t.includes('replacement') || t.includes('new system');
}
function isCallback(j) {
  const t = (j.jobType?.name || j.type || '').toLowerCase();
  return t.includes('callback') || t.includes('call back') || t.includes('warranty');
}
