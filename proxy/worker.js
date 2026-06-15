/* ============================================================
   Tide — data proxy (Cloudflare Worker)
   ------------------------------------------------------------
   Holds your API tokens as SECRETS (set via wrangler, never in
   code), calls Jira + Figma server-side, and returns ONE JSON
   payload shaped exactly like the dashboard's MOCK object.

   Secrets to set (see SETUP.md):
     JIRA_SITE        e.g. yourcompany.atlassian.net
     JIRA_EMAIL       your Atlassian login email
     JIRA_TOKEN       Atlassian API token
     JIRA_PROJECT     project key, e.g. PAY
     JIRA_BOARD_ID    (optional) Scrum board id for the sprint widget
     JIRA_POINTS_FIELD(optional) e.g. customfield_10016 (story points)
     FIGMA_TOKEN      Figma personal access token
     FIGMA_FILES      comma-separated file keys, e.g. abc123,def456
     CLICKUP_TOKEN    (optional) ClickUp personal API token (pk_...)
     CLICKUP_TEAM     (optional) ClickUp team/workspace id
     SLACK_TOKEN      (optional) Slack user/bot token (xoxp-/xoxb-...)
     ALLOW_ORIGIN     (optional) your dashboard origin, default "*"

   ClickUp + Slack are SCAFFOLDED: the fetchers below are wired to the
   real APIs but stay dormant until their tokens are present, so the
   board still works on Jira + Figma alone. Add the tokens to go live.
   ============================================================ */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const encryptionSecret = env.ENCRYPTION_KEY || 'tide-local-dev-encryption-key-32chars';

    // 1. Passwordless login link generation
    if (path === '/api/auth/login' && method === 'POST') {
      try {
        const { email } = await request.json();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return cors(env, json({ error: 'Invalid email address' }, 400));
        }

        // Insert user if not exists
        await env.DB.prepare(
          "INSERT OR IGNORE INTO users (email) VALUES (?)"
        ).bind(email).run();

        // Generate verification token
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

        await env.DB.prepare(
          "INSERT INTO login_tokens (email, token, expires_at) VALUES (?, ?, ?)"
        ).bind(email, token, expiresAt).run();

        // Magic link points to frontend index.html with query parameter
        const frontendUrl = env.FRONTEND_URL || `http://localhost:${env.PORT || 3000}`;
        const magicLink = `${frontendUrl}/?login_token=${token}`;

        return cors(env, json({ success: true, magicLink }));
      } catch (err) {
        return cors(env, json({ error: err.message }, 500));
      }
    }

    // 2. Magic link verification
    if (path === '/api/auth/verify' && method === 'POST') {
      try {
        const { token } = await request.json();
        if (!token) return cors(env, json({ error: 'Token is required' }, 400));

        const now = new Date().toISOString();
        const pendingToken = await env.DB.prepare(
          "SELECT * FROM login_tokens WHERE token = ? AND expires_at > ?"
        ).bind(token, now).first();

        if (!pendingToken) {
          return cors(env, json({ error: 'Invalid or expired magic link' }, 400));
        }

        const email = pendingToken.email;

        // Clean up verification token
        await env.DB.prepare(
          "DELETE FROM login_tokens WHERE token = ?"
        ).bind(token).run();

        // Retrieve user
        const user = await env.DB.prepare(
          "SELECT id, email FROM users WHERE email = ?"
        ).bind(email).first();

        if (!user) {
          return cors(env, json({ error: 'User not found' }, 404));
        }

        // Create user session (30 days)
        const sessionToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await env.DB.prepare(
          "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)"
        ).bind(user.id, sessionToken, expiresAt).run();

        return cors(env, json({ success: true, token: sessionToken, email }));
      } catch (err) {
        return cors(env, json({ error: err.message }, 500));
      }
    }

    // 3. Logout
    if (path === '/api/auth/logout' && method === 'POST') {
      try {
        const auth = request.headers.get('Authorization');
        const token = auth && auth.replace(/^Bearer /, '').trim();
        if (token) {
          await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
        }
        return cors(env, json({ success: true }));
      } catch (err) {
        return cors(env, json({ error: err.message }, 500));
      }
    }

    // --- Authentication Barrier ---
    // All endpoints below this point require a valid session_token
    const authHeader = request.headers.get('Authorization');
    const sessionToken = authHeader && authHeader.replace(/^Bearer /, '').trim();
    if (!sessionToken) {
      return cors(env, json({ error: 'Authorization required' }, 401));
    }

    const now = new Date().toISOString();
    const user = await env.DB.prepare(
      "SELECT u.id, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?"
    ).bind(sessionToken, now).first();

    if (!user) {
      return cors(env, json({ error: 'Invalid or expired session' }, 401));
    }

    // 4. Integrations API: Get settings
    if (path === '/api/integrations' && method === 'GET') {
      try {
        const row = await env.DB.prepare(
          "SELECT * FROM integrations WHERE user_id = ?"
        ).bind(user.id).first();

        const config = {
          JIRA_SITE: '', JIRA_EMAIL: '', JIRA_TOKEN: '', JIRA_PROJECT: '',
          JIRA_BOARD_ID: '', JIRA_POINTS_FIELD: '',
          FIGMA_TOKEN: '', FIGMA_FILES: '',
          CLICKUP_TOKEN: '', CLICKUP_TEAM: '',
          SLACK_TOKEN: ''
        };

        if (row) {
          config.JIRA_SITE = row.jira_site || '';
          config.JIRA_EMAIL = row.jira_email || '';
          config.JIRA_TOKEN = row.jira_token ? '********' : '';
          config.JIRA_PROJECT = row.jira_project || '';
          config.JIRA_BOARD_ID = row.jira_board_id || '';
          config.JIRA_POINTS_FIELD = row.jira_points_field || '';
          config.FIGMA_TOKEN = row.figma_token ? '********' : '';
          config.FIGMA_FILES = row.figma_files || '';
          config.CLICKUP_TOKEN = row.clickup_token ? '********' : '';
          config.CLICKUP_TEAM = row.clickup_team || '';
          config.SLACK_TOKEN = row.slack_token ? '********' : '';
        }

        return cors(env, json({ success: true, integrations: config }));
      } catch (err) {
        return cors(env, json({ error: err.message }, 500));
      }
    }

    // 5. Integrations API: Save settings
    if (path === '/api/integrations' && method === 'POST') {
      try {
        const { keys } = await request.json();
        if (!keys) return cors(env, json({ error: 'Keys are required' }, 400));

        // Get existing integrations so we don't overwrite masked tokens
        const existing = await env.DB.prepare(
          "SELECT * FROM integrations WHERE user_id = ?"
        ).bind(user.id).first();

        // Helper to process token field
        const processToken = async (newVal, dbVal) => {
          if (newVal === '********') return dbVal; // keep current database value
          if (!newVal) return null; // delete key
          return await encrypt(newVal, encryptionSecret); // encrypt new key
        };

        const jiraSite = keys.JIRA_SITE || null;
        const jiraEmail = keys.JIRA_EMAIL || null;
        const jiraToken = await processToken(keys.JIRA_TOKEN, existing?.jira_token);
        const jiraProject = keys.JIRA_PROJECT || null;
        const jiraBoardId = keys.JIRA_BOARD_ID || null;
        const jiraPointsField = keys.JIRA_POINTS_FIELD || null;
        const figmaToken = await processToken(keys.FIGMA_TOKEN, existing?.figma_token);
        const figmaFiles = keys.FIGMA_FILES || null;
        const clickupToken = await processToken(keys.CLICKUP_TOKEN, existing?.clickup_token);
        const clickupTeam = keys.CLICKUP_TEAM || null;
        const slackToken = await processToken(keys.SLACK_TOKEN, existing?.slack_token);

        await env.DB.prepare(`
          INSERT INTO integrations (
            user_id, jira_site, jira_email, jira_token, jira_project, jira_board_id, jira_points_field,
            figma_token, figma_files, clickup_token, clickup_team, slack_token, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATETIME('now'))
          ON CONFLICT(user_id) DO UPDATE SET
            jira_site=excluded.jira_site,
            jira_email=excluded.jira_email,
            jira_token=excluded.jira_token,
            jira_project=excluded.jira_project,
            jira_board_id=excluded.jira_board_id,
            jira_points_field=excluded.jira_points_field,
            figma_token=excluded.figma_token,
            figma_files=excluded.figma_files,
            clickup_token=excluded.clickup_token,
            clickup_team=excluded.clickup_team,
            slack_token=excluded.slack_token,
            updated_at=DATETIME('now')
        `).bind(
          user.id, jiraSite, jiraEmail, jiraToken, jiraProject, jiraBoardId, jiraPointsField,
          figmaToken, figmaFiles, clickupToken, clickupTeam, slackToken
        ).run();

        return cors(env, json({ success: true }));
      } catch (err) {
        return cors(env, json({ error: err.message }, 500));
      }
    }

    // 6. Test Integrations connection dynamically
    if (path === '/api/integrations/test' && method === 'POST') {
      try {
        const { integrationId, keys } = await request.json();
        if (!integrationId || !keys) {
          return cors(env, json({ error: 'integrationId and keys are required' }, 400));
        }

        // If a token in keys is masked, fetch the existing stored token from DB to test with
        const existing = await env.DB.prepare(
          "SELECT * FROM integrations WHERE user_id = ?"
        ).bind(user.id).first();

        const resolveToken = async (newVal, dbValEnc) => {
          if (newVal === '********') {
            if (!dbValEnc) return null;
            return await decrypt(dbValEnc, encryptionSecret);
          }
          return newVal || null;
        };

        const testKeys = { ...keys };
        if (integrationId === 'jira') {
          testKeys.JIRA_TOKEN = await resolveToken(keys.JIRA_TOKEN, existing?.jira_token);
        } else if (integrationId === 'figma') {
          testKeys.FIGMA_TOKEN = await resolveToken(keys.FIGMA_TOKEN, existing?.figma_token);
        } else if (integrationId === 'clickup') {
          testKeys.CLICKUP_TOKEN = await resolveToken(keys.CLICKUP_TOKEN, existing?.clickup_token);
        } else if (integrationId === 'slack') {
          testKeys.SLACK_TOKEN = await resolveToken(keys.SLACK_TOKEN, existing?.slack_token);
        }

        // Run connection test
        let result;
        if (integrationId === 'jira') {
          result = await getJira(testKeys);
        } else if (integrationId === 'figma') {
          result = await getFigma(testKeys);
        } else if (integrationId === 'clickup') {
          result = await getClickUp(testKeys);
        } else if (integrationId === 'slack') {
          result = await getSlack(testKeys);
        } else {
          return cors(env, json({ error: 'Unknown integrationId' }, 400));
        }

        if (result.error) {
          return cors(env, json({ success: false, error: result.error }));
        }
        return cors(env, json({ success: true }));
      } catch (err) {
        return cors(env, json({ success: false, error: err.message }));
      }
    }

    // 7. Get user unified dashboard data
    if ((path === '/' || path === '/api/dashboard') && method === 'GET') {
      try {
        const row = await env.DB.prepare(
          "SELECT * FROM integrations WHERE user_id = ?"
        ).bind(user.id).first();

        // If no integration setup is found, return empty structures
        if (!row) {
          const payload = normalize(null, null, null, null);
          payload._errors = [];
          payload._connected = { jira: false, figma: false, clickup: false, slack: false };
          return cors(env, json(payload));
        }

        // Decrypt keys
        const userEnv = {
          JIRA_SITE: row.jira_site || '',
          JIRA_EMAIL: row.jira_email || '',
          JIRA_TOKEN: row.jira_token ? await decrypt(row.jira_token, encryptionSecret) : '',
          JIRA_PROJECT: row.jira_project || '',
          JIRA_BOARD_ID: row.jira_board_id || '',
          JIRA_POINTS_FIELD: row.jira_points_field || '',
          FIGMA_TOKEN: row.figma_token ? await decrypt(row.figma_token, encryptionSecret) : '',
          FIGMA_FILES: row.figma_files || '',
          CLICKUP_TOKEN: row.clickup_token ? await decrypt(row.clickup_token, encryptionSecret) : '',
          CLICKUP_TEAM: row.clickup_team || '',
          SLACK_TOKEN: row.slack_token ? await decrypt(row.slack_token, encryptionSecret) : '',
        };

        // Fetch user data
        const [jira, figma, clickup, slack] = await Promise.all([
          getJira(userEnv).catch(e => ({ error: String(e) })),
          getFigma(userEnv).catch(e => ({ error: String(e) })),
          getClickUp(userEnv).catch(e => ({ error: String(e) })),
          getSlack(userEnv).catch(e => ({ error: String(e) })),
        ]);

        const payload = normalize(jira, figma, clickup, slack);
        payload._errors = [jira.error, figma.error, clickup.error, slack.error].filter(Boolean);
        payload._connected = {
          jira: !!userEnv.JIRA_TOKEN && !jira.error,
          figma: !!userEnv.FIGMA_TOKEN && !figma.error,
          clickup: !!userEnv.CLICKUP_TOKEN && !clickup.error,
          slack: !!userEnv.SLACK_TOKEN && !slack.error,
        };
        return cors(env, json(payload));
      } catch (err) {
        return cors(env, json({ error: err.message }, 500));
      }
    }

    // Default 404
    return cors(env, json({ error: 'Not Found' }, 404));
  }
};

/* ---------------- JIRA ---------------- */
async function getJira(env) {
  const proj = env.JIRA_PROJECT;
  const me = 'currentUser()';
  const F = ['summary', 'status', 'priority', 'duedate', 'updated', 'issuetype', 'assignee', 'reporter'];

  // One search per bucket, run in parallel.
  const q = (jql, max = 15) => jiraSearch(env, jql, F, max);
  const [blockers, wip, review, dueSoon, pulse] = await Promise.all([
    q(`assignee = ${me} AND status in ("Blocked","Impeded","On Hold") ORDER BY priority DESC`),
    q(`assignee = ${me} AND statusCategory = "In Progress" ORDER BY updated DESC`),
    q(`(assignee = ${me} OR reporter = ${me}) AND status in ("In Review","Code Review","Review") ORDER BY updated DESC`),
    q(`assignee = ${me} AND duedate <= 3d AND statusCategory != Done ORDER BY duedate ASC`),
    q(`project = ${proj} AND updated >= -1d ORDER BY updated DESC`, 8),
  ]);

  let sprint = null;
  if (env.JIRA_BOARD_ID) sprint = await getSprint(env).catch(() => null);

  return { blockers, wip, review, dueSoon, pulse, sprint };
}

async function jiraSearch(env, jql, fields, maxResults) {
  // Enhanced JQL search endpoint. If your instance errors here, swap to
  // the legacy path: `/rest/api/3/search` (same body shape).
  const res = await fetch(`https://${env.JIRA_SITE}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: jiraHeaders(env),
    body: JSON.stringify({ jql, fields, maxResults }),
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.issues || [];
}

async function getSprint(env) {
  const board = env.JIRA_BOARD_ID;
  const s = await fetch(`https://${env.JIRA_SITE}/rest/agile/1.0/board/${board}/sprint?state=active`, { headers: jiraHeaders(env) });
  const sprintData = (await s.json()).values?.[0];
  if (!sprintData) return null;

  const i = await fetch(`https://${env.JIRA_SITE}/rest/agile/1.0/sprint/${sprintData.id}/issue?maxResults=100&fields=status${env.JIRA_POINTS_FIELD ? ',' + env.JIRA_POINTS_FIELD : ''}`, { headers: jiraHeaders(env) });
  const issues = (await i.json()).issues || [];

  const pts = it => (env.JIRA_POINTS_FIELD ? (it.fields[env.JIRA_POINTS_FIELD] || 0) : 1);
  const total = issues.reduce((a, it) => a + pts(it), 0) || 1;
  const cat = it => it.fields.status?.statusCategory?.key; // 'done' | 'indeterminate' | 'new'
  const done = issues.filter(it => cat(it) === 'done').reduce((a, it) => a + pts(it), 0);
  const review = issues.filter(it => /review/i.test(it.fields.status?.name || '')).reduce((a, it) => a + pts(it), 0);
  const prog = Math.max(0, total - done - review);

  const end = new Date(sprintData.endDate);
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 864e5));
  const start = new Date(sprintData.startDate);
  const dayOf = Math.max(1, Math.ceil((Date.now() - start) / 864e5));
  const len = Math.max(1, Math.ceil((end - start) / 864e5));

  return {
    name: sprintData.name, daysLeft, dayOf, len,
    pct: { done: pct(done, total), prog: pct(prog, total), rev: pct(review, total) },
    pointsDone: round(done), pointsTotal: round(total),
  };
}

function jiraHeaders(env) {
  return {
    'Authorization': 'Basic ' + btoa(`${env.JIRA_EMAIL}:${env.JIRA_TOKEN}`),
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

/* ---------------- FIGMA ---------------- */
async function getFigma(env) {
  const token = env.FIGMA_TOKEN;
  const files = (env.FIGMA_FILES || '').split(',').map(s => s.trim()).filter(Boolean);
  const H = { 'X-Figma-Token': token };

  const me = await fetch('https://api.figma.com/v1/me', { headers: H }).then(r => r.json()).catch(() => ({}));
  const myHandle = (me.handle || '').toLowerCase();

  const updates = [], comments = [];
  for (const key of files) {
    const meta = await fetch(`https://api.figma.com/v1/files/${key}?depth=1`, { headers: H }).then(r => r.json()).catch(() => null);
    if (meta?.name) updates.push({ name: meta.name, lastModified: meta.lastModified, version: meta.version });

    const cm = await fetch(`https://api.figma.com/v1/files/${key}/comments`, { headers: H }).then(r => r.json()).catch(() => ({ comments: [] }));
    for (const c of (cm.comments || [])) {
      if (c.resolved_at) continue;
      const msg = c.message || '';
      comments.push({
        file: meta?.name || key,
        author: c.user?.handle || 'someone',
        message: msg,
        created_at: c.created_at,
        mentionsMe: myHandle && msg.toLowerCase().includes('@' + myHandle),
      });
    }
  }
  return { updates, comments };
}

/* ---------------- CLICKUP (scaffold) ----------------
   Dormant until CLICKUP_TOKEN + CLICKUP_TEAM are set. Pulls tasks
   assigned to you that are open and due soon. Shape mirrors what the
   dashboard's attention feed expects (see normalize → clickup items). */
async function getClickUp(env) {
  if (!env.CLICKUP_TOKEN || !env.CLICKUP_TEAM) return { tasks: [] };
  const H = { 'Authorization': env.CLICKUP_TOKEN, 'Accept': 'application/json' };

  // Identify "me" so we can filter to my assignments.
  const me = await fetch('https://api.clickup.com/api/v2/user', { headers: H }).then(r => r.json()).catch(() => ({}));
  const myId = me?.user?.id;

  // Open tasks across the workspace, narrowed to me, ordered by due date.
  const params = new URLSearchParams({ order_by: 'due_date', subtasks: 'true', include_closed: 'false' });
  if (myId) params.append('assignees[]', String(myId));
  const res = await fetch(`https://api.clickup.com/api/v2/team/${env.CLICKUP_TEAM}/task?${params}`, { headers: H });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
  const data = await res.json();

  const tasks = (data.tasks || []).map(t => ({
    id: t.id,
    name: t.name,
    status: t.status?.status || '',
    url: t.url,
    due: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
    updated: t.date_updated ? new Date(Number(t.date_updated)).toISOString() : null,
    list: t.list?.name || '',
    priority: t.priority?.priority || null, // 'urgent' | 'high' | 'normal' | 'low'
  }));
  return { tasks };
}

/* ---------------- SLACK (scaffold) ----------------
   Dormant until SLACK_TOKEN is set. Pulls unread mentions/threads
   needing a reply. Uses search.messages (requires search:read) and
   falls back gracefully if scopes are missing. */
async function getSlack(env) {
  if (!env.SLACK_TOKEN) return { mentions: [] };
  const H = { 'Authorization': `Bearer ${env.SLACK_TOKEN}`, 'Accept': 'application/json' };

  // Who am I, so we can search for mentions of my handle.
  const auth = await fetch('https://slack.com/api/auth.test', { headers: H }).then(r => r.json()).catch(() => ({}));
  if (!auth.ok) throw new Error(`Slack auth: ${auth.error || 'unknown'}`);

  // Messages that mention me, newest first.
  const q = encodeURIComponent('is:unread to:me OR @' + (auth.user || ''));
  const res = await fetch(`https://slack.com/api/search.messages?query=${q}&count=15&sort=timestamp`, { headers: H });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack search: ${data.error || 'unknown'}`);

  const mentions = (data.messages?.matches || []).map(m => ({
    id: m.iid || m.ts,
    channel: m.channel?.name ? '#' + m.channel.name : 'DM',
    author: m.username || m.user || 'someone',
    text: m.text || '',
    url: m.permalink,
    ts: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : null,
  }));
  return { mentions };
}

/* ---------------- NORMALIZE → dashboard shape ---------------- */
function normalize(jira, figma, clickup, slack) {
  jira = jira || {}; figma = figma || {}; clickup = clickup || {}; slack = slack || {};
  const J = jira.blockers ? jira : { blockers: [], wip: [], review: [], dueSoon: [], pulse: [], sprint: null };
  const Fg = figma.updates ? figma : { updates: [], comments: [] };
  const Cu = clickup.tasks ? clickup : { tasks: [] };
  const Sl = slack.mentions ? slack : { mentions: [] };

  // ---- metrics ----
  const metrics = [];
  if (J.sprint) {
    metrics.push({ label: 'Sprint Day', val: String(J.sprint.dayOf), sub: '/ ' + J.sprint.len, meta: J.sprint.daysLeft + ' days remaining', accent: 'var(--amber)' });
    const onTrack = J.sprint.pct.done;
    metrics.push({ label: 'On Track', val: String(onTrack), sub: '%', meta: `${J.sprint.pointsDone} of ${J.sprint.pointsTotal} done`, accent: 'var(--green)' });
  }
  metrics.push({ label: 'Blockers', val: String(J.blockers.length), sub: '', meta: J.blockers.length ? 'need your attention' : 'all clear', accent: 'var(--red)' });
  metrics.push({ label: 'My WIP', val: String(J.wip.length), sub: '', meta: J.wip.length > 3 ? 'over a healthy limit' : 'in progress', accent: 'var(--blue)' });
  const figmaMentions = Fg.comments.filter(c => c.mentionsMe).length;
  metrics.push({ label: 'In Review', val: String(J.review.length), sub: '', meta: `${figmaMentions} design mention${figmaMentions === 1 ? '' : 's'}`, accent: 'var(--violet)' });

  // ---- attention feed (unified across all sources, sorted) ----
  const attention = [];
  for (const it of J.blockers) attention.push(mapIssue(it, 'p0', 'blocked'));
  for (const c of Fg.comments.filter(c => c.mentionsMe)) attention.push(mapComment(c, 'p0', 'mention'));
  for (const it of J.dueSoon) attention.push(mapIssue(it, isOverdue(it) ? 'p0' : 'p1', null));
  for (const it of J.review) attention.push(mapIssue(it, 'p1', 'review'));
  for (const t of Cu.tasks) attention.push(mapTask(t));
  for (const m of Sl.mentions) attention.push(mapMention(m));
  for (const c of Fg.comments.filter(c => !c.mentionsMe).slice(0, 3)) attention.push(mapComment(c, 'p2', null));
  attention.sort((a, b) => a.pri.localeCompare(b.pri));
  const attn = attention.slice(0, 14);

  // ---- sprint widget ----
  const sprint = J.sprint
    ? { name: J.sprint.name, daysLeft: J.sprint.daysLeft, done: J.sprint.pct.done, prog: J.sprint.pct.prog, rev: J.sprint.pct.rev, pointsDone: J.sprint.pointsDone, pointsTotal: J.sprint.pointsTotal }
    : { name: 'No active sprint', daysLeft: 0, done: 0, prog: 0, rev: 0, pointsDone: 0, pointsTotal: 0 };

  // ---- activity feeds ----
  const jiraFeed = J.pulse.map(it => ({
    who: initials(it.fields.assignee?.displayName || it.fields.reporter?.displayName || '··'),
    color: 'var(--blue)',
    bold: (it.fields.assignee?.displayName || 'Someone').split(' ')[0],
    txt: `updated <b>${it.key}</b> — <span class="m">${esc(trunc(it.fields.summary, 42))}</span>`,
    t: ago(it.fields.updated),
  }));

  const figmaFeed = [
    ...Fg.updates.map(u => ({ who: 'FG', color: 'var(--violet)', bold: u.name, txt: `<span class="m">updated</span>`, t: ago(u.lastModified) })),
    ...Fg.comments.slice(0, 4).map(c => ({ who: initials(c.author), color: 'var(--cyan)', bold: c.author, txt: `commented on <b>${esc(c.file)}</b>`, t: ago(c.created_at) })),
  ].slice(0, 6);

  return { metrics, attention: attn, sprint, jira: jiraFeed, figma: figmaFeed };
}

/* ---------------- mappers + helpers ----------------
   Each attention item carries updatedISO/dueISO so the dashboard can
   compute staleness + SLA flags client-side (shared with My Day). */
function mapIssue(it, pri, chip) {
  return {
    src: 'jira', pri, key: it.key,
    title: esc(it.fields.summary || ''),
    desc: `${it.fields.issuetype?.name || 'Issue'} · ${it.fields.status?.name || ''}${it.fields.duedate ? ' · due ' + it.fields.duedate : ''}`,
    chip, when: ago(it.fields.updated),
    updatedISO: it.fields.updated || null,
    dueISO: it.fields.duedate || null,
  };
}
function mapComment(c, pri, chip) {
  return {
    src: 'figma', pri, key: trunc(c.file, 18),
    title: esc(trunc(c.message, 80)) || 'New comment',
    desc: `${c.author} commented`,
    chip, when: ago(c.created_at),
    updatedISO: c.created_at || null, dueISO: null,
  };
}
function mapTask(t) {
  const overdue = t.due && new Date(t.due) < new Date();
  const pri = t.priority === 'urgent' || overdue ? 'p0' : t.priority === 'high' ? 'p1' : 'p2';
  return {
    src: 'clickup', pri, key: trunc(t.list || 'Task', 18),
    title: esc(trunc(t.name, 80)),
    desc: `${t.status || 'open'}${t.due ? ' · due ' + t.due.slice(0, 10) : ''}`,
    chip: overdue ? 'overdue' : 'due', when: ago(t.updated),
    updatedISO: t.updated || null, dueISO: t.due || null,
  };
}
function mapMention(m) {
  return {
    src: 'slack', pri: 'p1', key: trunc(m.channel, 18),
    title: esc(trunc(m.text, 80)) || 'New message',
    desc: `${m.author} mentioned you`,
    chip: 'reply', when: ago(m.ts),
    updatedISO: m.ts || null, dueISO: null,
  };
}
const isOverdue = it => it.fields.duedate && new Date(it.fields.duedate) < new Date();
const pct = (n, d) => Math.round((n / d) * 100);
const round = n => Math.round(n * 10) / 10;
function initials(name) { return (name || '··').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
function trunc(s, n) { s = s || ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function esc(s) { return (s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function ago(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
function cors(env, res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', env.ALLOW_ORIGIN || '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, headers: h });
}

/* ---------------- CRYPTO HELPERS ---------------- */
const ENCRYPTION_ALGO = 'AES-GCM';

async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  const paddedSecret = secret.padEnd(32, '0').slice(0, 32);
  const rawKey = enc.encode(paddedSecret);
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: ENCRYPTION_ALGO },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(text, secret) {
  if (!text) return null;
  const key = await getCryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGO, iv },
    key,
    enc.encode(text)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return arrayBufferToBase64(combined.buffer);
}

async function decrypt(encryptedBase64, secret) {
  if (!encryptedBase64) return null;
  try {
    const key = await getCryptoKey(secret);
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: ENCRYPTION_ALGO, iv },
      key,
      ciphertext
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (e) {
    console.error('Decryption failed:', e);
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

