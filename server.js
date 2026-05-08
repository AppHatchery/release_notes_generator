require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// GET /api/repos
app.get('/api/repos', async (req, res) => {
  try {
    const repos = await githubFetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated'
    );
    res.json(
      repos.map(r => ({
        id: r.id,
        full_name: r.full_name,
        name: r.name,
        owner: r.owner.login,
      }))
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/repos/:owner/:repo/pulls
app.get('/api/repos/:owner/:repo/pulls', async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const pulls = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&per_page=50`
    );
    const merged = pulls.filter(p => p.merged_at);
    res.json(
      merged.map(p => ({
        number: p.number,
        title: p.title,
        body: p.body,
        labels: p.labels.map(l => l.name),
        merged_at: p.merged_at,
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
      `https://api.github.com/repos/${owner}/${repo}/issues?state=closed&per_page=50`
    );
    const filtered = issues.filter(i => !i.pull_request);
    res.json(
      filtered.map(i => ({
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels.map(l => l.name),
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
  const { repo, version, releaseDate, items } = req.body;

  const itemsList = items
    .map(item => {
      const desc = item.body
        ? item.body.substring(0, 500).replace(/\n+/g, ' ')
        : 'No description';
      const labels = item.labels.length ? item.labels.join(', ') : 'none';
      return `- [${item.type.toUpperCase()} #${item.number}] ${item.title}\n  Labels: ${labels}\n  Description: ${desc}`;
    })
    .join('\n');

  const userPrompt = `Generate release notes for version ${version} released on ${releaseDate}.

Here are the changes (PRs and Issues):
${itemsList}

Return a JSON object with exactly two keys:

"store": App Store / Google Play format
- Header: "What's New in Version ${version}"
- Max 6 bullet points using "•"
- Bold title + one-line user benefit (use ** for bold)
- Simple non-technical language, focus on user benefit
- Always end with "• Bug fixes and performance improvements"

"github": GitHub Release Notes format
- Header: "Release v${version} (${releaseDate})"
- Group under "✨ Features & Enhancements" and "🐛 Bug Fixes" using GitHub Markdown
- Bold category headers
- Numbered sub-points per item: what the issue was, how it was resolved, expected behavior after fix
- Use labels to determine which section each item belongs in (bug → Bug Fixes, everything else → Features)`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system:
        'You are a technical writer generating release notes from GitHub PR and Issue data. Always respond with valid JSON only — no markdown, no explanation, no backticks.',
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = message.content[0].text;
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return res
        .status(500)
        .json({ error: 'Failed to parse Anthropic response as JSON', raw: rawText });
    }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Release Notes Generator running at http://localhost:${PORT}`);
});
