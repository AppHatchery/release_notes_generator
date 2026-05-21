# Contributing

Thanks for your interest in contributing! Here's how to get involved.

## Reporting Bugs

Open an issue and include:
- What you did
- What you expected to happen
- What actually happened
- Your Node.js version (`node -v`)

## Suggesting Features

Open an issue with a clear description of the feature and why it would be useful. For larger changes, it's worth opening an issue for discussion before writing code.

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Follow the [local setup steps in the README](README.md#setup)
3. Make your changes
4. Test that the app runs correctly (`npm start`)
5. Open a pull request with a clear description of what changed and why

Keep PRs focused — one feature or fix per PR makes review easier.

## Development Tips

- `npm run dev` uses Node's built-in `--watch` flag for auto-restart on file changes
- All API logic lives in `server.js`; all UI logic lives in `public/index.html`
- The app has no build step — changes to `index.html` are reflected immediately on page refresh

## Code Style

- No framework, no bundler — keep it that way unless there's a strong reason
- Prefer clear, readable code over clever code
- Don't add dependencies without discussion
