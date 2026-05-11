require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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
  return res.json();
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

    const byDate = (a, b) => new Date(b.updated_at) - new Date(a.updated_at);

    const personal = [];
    const orgMap   = new Map(); // orgLogin → repo[]

    for (const r of userRepos) {
      if (r.owner.login === me.login) {
        personal.push(r);
      } else {
        if (!orgMap.has(r.owner.login)) orgMap.set(r.owner.login, []);
        orgMap.get(r.owner.login).push(r);
      }
    }

    personal.sort(byDate);
    const orgGroups = [...orgMap.entries()]
      .map(([name, repos]) => ({ name, repos: repos.sort(byDate).map(shapeRepo) }))
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

// GET /api/repos/:owner/:repo/pulls
app.get('/api/repos/:owner/:repo/pulls', async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const pulls = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100&sort=updated`
    );
    const statusOrder = { open: 0, merged: 1, draft: 2, closed: 3 };
    pulls.sort((a, b) => statusOrder[prStatus(a)] - statusOrder[prStatus(b)]);
    res.json(
      pulls.map(p => ({
        number: p.number,
        title: p.title,
        body: p.body,
        labels: p.labels.map(l => l.name),
        status: prStatus(p),
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
    const issues = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&sort=updated`
    );
    const filtered = issues.filter(i => !i.pull_request);
    filtered.sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1));
    res.json(
      filtered.map(i => ({
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels.map(l => l.name),
        status: i.state,
        closed_at: i.closed_at,
        user: { login: i.user.login },
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/generate
app.post('/api/generate', async (req, res) => {
  const { repo, version, releaseDate, items, tone = 'non-technical' } = req.body;

  const itemsList = items
    .map(item => {
      const desc = item.body
        ? item.body.substring(0, 500).replace(/\n+/g, ' ')
        : 'No description';
      const labels = item.labels.length ? item.labels.join(', ') : 'none';
      return `- [${item.type.toUpperCase()} #${item.number}] ${item.title}\n  Labels: ${labels}\n  Description: ${desc}`;
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

  const userPrompt = `Generate release notes for version ${version} released on ${releaseDate}.

Tone guidance:
${toneGuide}

Here are the changes (PRs and Issues):
${itemsList}

Return a JSON object with exactly three keys:

"store": App Store / Google Play format
- Header: "What's New in Version ${version}"
- Max 6 bullet points using "•"
- Bold title + one-line user benefit (use ** for bold)
- Always end with "• Bug fixes and performance improvements"

"github": GitHub Release Notes format
- Header: "Release v${version} (${releaseDate})"
- Group under "✨ Features & Enhancements" and "🐛 Bug Fixes" using GitHub Markdown
- Bold category headers
- Numbered sub-points per item: what the issue was, how it was resolved, expected behavior after fix
- Use labels to determine which section each item belongs in (bug → Bug Fixes, everything else → Features)

"newsletter": Email newsletter format — exciting, engaging copy
- First line: ## 🚀 [short punchy release title that captures the spirit of this release]
- Section 1 "## ✨ Headline Feature": pick the single most exciting/impactful change. Write 2–3 engaging sentences leading with the user benefit. Make it feel like a product moment.
- Section 2 "## What's New": bullet list (use •) of the remaining feature/enhancement changes. Each bullet: bold feature name + 1 sentence of enthusiastic but informative description.
- Section 3 "## 🐛 Bug Fixes & Polish": bullet list (use •) of bug fixes and polish items. Each bullet: bold issue name + 1 short sentence on what's better now.
- Use markdown throughout. Tone: warm, enthusiastic, written for users who love the product.`;

  if (!anthropic) {
    return res.json({
      store: `What's New in Version ${version}\n\n• **Dummy store note** — placeholder while Anthropic API key is not set\n• **Another improvement** — things work better now\n• Bug fixes and performance improvements`,
      github: `## Release v${version} (${releaseDate})\n\n### ✨ Features & Enhancements\n1. **Dummy feature** — placeholder while Anthropic API key is not configured.\n\n### 🐛 Bug Fixes\n1. **Dummy fix** — placeholder while Anthropic API key is not configured.`,
      newsletter: `## 🚀 v${version} Is Here!\n\n## ✨ Headline Feature\nPlaceholder headline — add your Anthropic API key to generate real content.\n\n## What's New\n• **Placeholder feature** — description goes here.\n\n## Bug Fixes & Polish\nPlaceholder polish copy.`,
    });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [
        {
          name: 'generate_release_notes',
          description: 'Generate release notes in three formats',
          input_schema: {
            type: 'object',
            properties: {
              store:      { type: 'string', description: 'App Store / Google Play format' },
              github:     { type: 'string', description: 'GitHub Release Notes format' },
              newsletter: { type: 'string', description: 'Email newsletter format' },
            },
            required: ['store', 'github', 'newsletter'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'generate_release_notes' },
      messages: [{ role: 'user', content: userPrompt }],
    });

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
