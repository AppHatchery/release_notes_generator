# Release Notes Generator

Generate polished release notes from GitHub PRs and Issues using Claude AI — two formats at once: App Store/Play Store and GitHub Releases.

## Features

- Browse repos across your personal account and organizations
- Select individual PRs and Issues to include
- Choose between technical and non-technical tone
- Generates two formats simultaneously: App Store/Play Store and GitHub Releases markdown
- Search and filter PRs/Issues
- One-click copy to clipboard

## Tech Stack

- **Backend:** Node.js, Express
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **AI:** [Anthropic Claude](https://www.anthropic.com) via `@anthropic-ai/sdk`
- **Data:** GitHub REST API

## Setup

### 1. Clone the repo

```bash
git clone <repo-url>
cd release-notes-generator
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials:

```
GITHUB_TOKEN=ghp_your_github_token_here
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key_here
PORT=3000
```

**GitHub Token** — create one at https://github.com/settings/tokens  
Scopes needed: `repo` (for private repos) or `public_repo` (for public repos only)  
If using a fine-grained token, enable **Contents: Read-only** under repository permissions.

**Anthropic API Key** — get one at https://console.anthropic.com

### 3. Install dependencies

```bash
npm install
```

### 4. Start the server

```bash
npm start
```

Open http://localhost:3000 in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

## Requirements

- Node.js 18 or later (uses built-in `fetch`)
- A GitHub account with at least one repository
- An Anthropic API key with access to `claude-sonnet-4-6`

## Project Structure

```
├── server.js        # Express server and GitHub/Anthropic API logic
├── public/
│   └── index.html   # Single-page frontend (HTML, CSS, JS)
├── .env.example     # Environment variable template
└── package.json
```

## Deployment

### Deploy to Render

The repo includes a `render.yaml` config for one-click deployment.

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo — Render will detect `render.yaml` automatically
4. Add the following environment variables in the Render dashboard under **Environment**:

   | Variable | Value |
   |---|---|
   | `GITHUB_TOKEN` | Your GitHub personal access token |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key |

   > `PORT` is injected by Render automatically — do not set it manually.

5. Click **Deploy** — Render runs `npm install` then `npm start`

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on reporting bugs, suggesting features, and submitting pull requests.

## License

MIT — see [LICENSE](LICENSE) for details.
