# Throne Finder

A static, privacy-friendly route planner concept for finding dependable public washrooms along a trip. The experience is designed as a companion to Explore Local and uses local sample data so it works without a backend.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

The Vite config uses a relative asset base, so the built site works from a repository subpath.

1. Push this folder to a GitHub repository.
2. Run `npm install && npm run build`.
3. Publish the generated `dist` folder with GitHub Actions, or choose a Pages workflow that runs the same build command.

All interactions and saved washrooms run in the browser. Saved stops use `localStorage`; there is no API or database.
