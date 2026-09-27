# Throne Finder

A static, privacy-friendly route planner for finding public washrooms along a trip. The experience is designed as a companion to Explore Local and works without a custom backend.

## Live services

- Leaflet with OpenStreetMap map tiles
- Browser Geolocation API for the starting point
- Nominatim for user-submitted Canadian address searches
- Valhalla for pedestrian routes
- City of Toronto Open Data for current washroom locations, status, hours, and accessibility details
- Google Maps universal directions links for starting navigation

The current facility feed covers Toronto. The public endpoints are appropriate for a demonstration and light traffic. A larger production launch should use hosted geocoding and routing services with service guarantees.

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

All interactions and saved washrooms run in the browser. Saved stops use `localStorage`; there is no application server or database.
