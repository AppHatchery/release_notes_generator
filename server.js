require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 })
  : null;

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    'User-Agent': 'release-notes-app',
    Accept: 'application/vnd.github.v3+json',
  };
}

async function githubFetch(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`[githubFetch] ${res.status} ${url}`, body);
    const message = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'
      ? 'GitHub API rate limit exceeded. Please wait and try again.'
      : body.message || `GitHub API error: ${res.status} ${res.statusText}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function githubFetchAll(url) {
  const results = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers: githubHeaders() });
    if (res.status === 403) {
      const err = new Error('GitHub API rate limit exceeded. Please wait and try again.');
      err.status = 403;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`GitHub API error: ${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    const page = await res.json();
    results.push(...page);
    next = parseNextLink(res.headers.get('link'));
  }
  return results;
}

function shapeRepo(r) {
  return { id: r.id, full_name: r.full_name, name: r.name, owner: r.owner.login };
}

// GET /api/repos — returns { personal: [...], orgs: [{ name, repos }] }
app.get('/api/repos', async (req, res) => {
  try {
    const [me, userRepos] = await Promise.all([
      githubFetch('https://api.github.com/user'),
      githubFetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member'),
    ]);

    const byName = (a, b) => a.name.localeCompare(b.name);

    const personal = [];
    const orgMap   = new Map();

    for (const r of userRepos) {
      if (r.owner.login === me.login) {
        personal.push(r);
      } else {
        if (!orgMap.has(r.owner.login)) orgMap.set(r.owner.login, []);
        orgMap.get(r.owner.login).push(r);
      }
    }

    personal.sort(byName);
    const orgGroups = [...orgMap.entries()]
      .map(([name, repos]) => ({ name, repos: repos.sort(byName).map(shapeRepo) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ personal: personal.map(shapeRepo), orgs: orgGroups });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

function prStatus(p) {
  if (p.draft)     return 'draft';
  if (p.merged_at) return 'merged';
  if (p.state === 'open') return 'open';
  return 'closed';
}

// GET /api/repos/:owner/:repo/latest-release
app.get('/api/repos/:owner/:repo/latest-release', async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const release = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    );
    const tag = release.tag_name.replace(/^v/, '');
    const incremented = tag.replace(/(\d+)$/, n => String(Number(n) + 1));
    res.json({ version: incremented });
  } catch (err) {
    if (err.status === 404) return res.json({ version: '1.0' });
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/repos/:owner/:repo/pulls
app.get('/api/repos/:owner/:repo/pulls', async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const pulls = await githubFetchAll(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`
    );
    res.json(
      pulls.map(p => ({
        number: p.number,
        title: p.title,
        body: p.body,
        labels: p.labels.map(l => l.name),
        status: prStatus(p),
        created_at: p.created_at,
        merged_at: p.merged_at,
        closed_at: p.closed_at,
        user: { login: p.user.login },
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/repos/:owner/:repo/issues
app.get('/api/repos/:owner/:repo/issues', async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const issues = await githubFetchAll(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&sort=updated&direction=desc`
    );
    const filtered = issues.filter(i => !i.pull_request);
    res.json(
      filtered.map(i => ({
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels.map(l => l.name),
        status: i.state,
        created_at: i.created_at,
        closed_at: i.closed_at,
        user: { login: i.user.login },
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

const FORMAT_SCHEMA = {
  store:      { type: 'string', description: 'App Store / Google Play format' },
  github:     { type: 'string', description: 'GitHub Release Notes format' },
  newsletter: { type: 'string', description: 'Email newsletter format' },
  test_plan:  { type: 'string', description: 'QA test plan in markdown using the provided template' },
};

function formatPromptSection(fmt, version, releaseDate) {
  if (fmt === 'store') return `"store": App Store / Google Play format
- Header: "What's New in Version ${version}"
- Max 6 bullet points using "•"
- Bold title + one-line user benefit (use ** for bold)
- Always end with "• Bug fixes and performance improvements"`;

  if (fmt === 'github') return `"github": GitHub Release Notes format
- Header: "Release v${version} (${releaseDate})"
- Group under "✨ Features & Enhancements" and "🐛 Bug Fixes" using GitHub Markdown
- Bold category headers
- Numbered sub-points per item: what the issue was, how it was resolved, expected behavior after fix
- Use labels to determine which section each item belongs in (bug → Bug Fixes, everything else → Features)`;

  if (fmt === 'newsletter') return `"newsletter": Email newsletter format — exciting, engaging copy
- First line: ## 🚀 [short punchy release title that captures the spirit of this release]
- Section 1 "## ✨ Headline Feature": pick the single most exciting/impactful change. Write 2–3 engaging sentences leading with the user benefit. Make it feel like a product moment.
- Section 2 "## What's New": bullet list (use •) of the remaining feature/enhancement changes. Each bullet: bold feature name + 1 sentence of enthusiastic but informative description.
- Section 3 "## 🐛 Bug Fixes & Polish": bullet list (use •) of bug fixes and polish items. Each bullet: bold issue name + 1 short sentence on what's better now.
- Use markdown throughout. Tone: warm, enthusiastic, written for users who love the product.`;

  if (fmt === 'test_plan') return `"test_plan": QA test plan for this release, using this exact template structure:
# Test Plan — [short name capturing the spirit of this release]

**Build / version:** ${version}
**Platform(s):** _[infer from labels/context, or write "All platforms" if unclear]_

## Issues covered
[One bullet per item: \`#<number>\` — <title> (<URL from the item data above>) — one-line summary of what changed/fixed]

---

## What to test

[One ### section per issue. For each:
### \`#<number>\` — <title>
- [ ] [What should now happen — verify it does]
- [ ] [Another thing to check]
- [ ] [Edge case: empty state, offline, error condition, etc.]
]

---

## Heads-up
- [Anything testers need to know: test accounts, how to trigger flows, what NOT to worry about, nearby areas that may be affected]

Write concrete, actionable checkboxes — not vague ones. Derive test steps from the PR/issue descriptions and labels.`;
}

// POST /api/generate
app.post('/api/generate', async (req, res) => {
  const { repo, version, releaseDate, items, tone = 'non-technical', formats } = req.body;

  const validFormats = ['store', 'github', 'newsletter', 'test_plan'];
  const selectedFormats = Array.isArray(formats)
    ? formats.filter(f => validFormats.includes(f))
    : validFormats;
  if (!selectedFormats.length) {
    return res.status(400).json({ error: 'At least one format must be selected.' });
  }

  const itemsList = items
    .map(item => {
      const desc = item.body
        ? item.body.substring(0, 500).replace(/\n+/g, ' ')
        : 'No description';
      const labels = item.labels.length ? item.labels.join(', ') : 'none';
      const urlPath = item.type === 'pr' ? 'pull' : 'issues';
      const url = `https://github.com/${repo}/${urlPath}/${item.number}`;
      return `- [${item.type.toUpperCase()} #${item.number}] ${item.title}\n  URL: ${url}\n  Labels: ${labels}\n  Description: ${desc}`;
    })
    .join('\n');

  const toneGuide = tone === 'technical'
    ? `Audience: developers and technical team members.
- Use technical language freely (function names, API changes, component names are fine).
- For "store": stay concise but can reference specific feature areas by name.
- For "github": include technical specifics — affected modules, breaking changes, migration notes where relevant.`
    : `Audience: general users and non-technical stakeholders.
- Use plain English only — no jargon, acronyms, or code references.
- For "store": focus entirely on visible user benefit ("you can now…", "we fixed…").
- For "github": describe what changed and why it matters without implementation details.`;

  const formatSections = selectedFormats
    .map(f => formatPromptSection(f, version, releaseDate))
    .join('\n\n');

  const userPrompt = `Generate the following for version ${version} released on ${releaseDate}.

Tone guidance:
${toneGuide}

Here are the changes (PRs and Issues):
${itemsList}

Return a JSON object with exactly ${selectedFormats.length} key${selectedFormats.length > 1 ? 's' : ''}:

${formatSections}`;

  if (!anthropic) {
    const dummy = {
      store: `What's New in Version ${version}\n\n• **Dummy store note** — placeholder while Anthropic API key is not set\n• **Another improvement** — things work better now\n• Bug fixes and performance improvements`,
      github: `## Release v${version} (${releaseDate})\n\n### ✨ Features & Enhancements\n1. **Dummy feature** — placeholder while Anthropic API key is not configured.\n\n### 🐛 Bug Fixes\n1. **Dummy fix** — placeholder while Anthropic API key is not configured.`,
      newsletter: `## 🚀 v${version} Is Here!\n\n## ✨ Headline Feature\nPlaceholder headline — add your Anthropic API key to generate real content.\n\n## What's New\n• **Placeholder feature** — description goes here.\n\n## Bug Fixes & Polish\nPlaceholder polish copy.`,
      test_plan: `# Test Plan — v${version}\n\n**Build / version:** ${version}\n**Platform(s):** All platforms\n\n## Issues covered\n- Placeholder while Anthropic API key is not configured.\n\n---\n\n## What to test\n\n### Placeholder\n- [ ] Add your Anthropic API key to generate a real test plan.\n\n---\n\n## Heads-up\n- Set ANTHROPIC_API_KEY to enable AI-generated test plans.`,
    };
    return res.json(Object.fromEntries(selectedFormats.map(f => [f, dummy[f]])));
  }

  res.setTimeout(120_000);

  const schemaProperties = Object.fromEntries(selectedFormats.map(f => [f, FORMAT_SCHEMA[f]]));

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8096,
      tools: [
        {
          name: 'generate_release_notes',
          description: 'Generate release notes in the requested formats',
          input_schema: {
            type: 'object',
            properties: schemaProperties,
            required: selectedFormats,
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'generate_release_notes' },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const message = await stream.finalMessage();
    const toolUse = message.content.find(c => c.type === 'tool_use');
    if (!toolUse) {
      return res.status(500).json({ error: 'No tool_use block in Anthropic response' });
    }
    res.json(toolUse.input);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Release Notes Generator running at http://localhost:${PORT}`);
});
