# INSPIRE-HEP Author Tracker

Pure frontend INSPIRE-HEP query tool designed for static hosting such as GitHub Pages.

INSPIRE-HEP Author Tracker is a lightweight browser-based tool for checking recent papers from selected authors on INSPIRE-HEP. It supports both recent-day queries and custom date ranges, renders an HTML report directly in the page, and lets you download the generated report for sharing or archiving.

Version: `v0.1`

## Features

- Upload `authors.txt` or paste author lines directly
- Support two query modes: recent days with default `30`, or a custom date range
- Query INSPIRE-HEP from the browser
- Render a report preview in HTML
- Download the generated report as an HTML file
- Display per-author paper sections and deduplicated unique-paper counts
- Limit displayed author lists to the first 5 names followed by `et al.` when needed
- Include arXiv links and INSPIRE-HEP literature links in the report

## Project Files

- `index.html`: page structure
- `styles.css`: page and report styles
- `app.js`: frontend query logic, report rendering, rate limiting, and app metadata
- `authors.txt`: optional local sample input file

## Input Format

```text
Nima Arkani-Hamed,https://inspirehep.net/authors/1018121
Edward Witten,https://inspirehep.net/authors/983328
```

## Local Preview

Run a small static server in the project directory:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## GitHub Pages

This project is designed to work well as a static GitHub Pages site.

Recommended setup:

1. Upload this folder to a GitHub repository
2. Make sure `index.html`, `styles.css`, and `app.js` are in the publishable root
3. Enable GitHub Pages for the repository root branch
4. After deployment, update the `PROJECT_LINK` value at the top of `app.js` to your real repository URL

## Notes

- This version is static-site friendly and does not require a Python backend.
- Browser requests go directly to the INSPIRE-HEP literature API.
- The frontend currently includes concurrency control with 4 workers.
- The frontend includes a rate-window guard at 10 requests per 5 seconds.
- The frontend retries on `HTTP 429`.
- The frontend stops after 3 failed attempts for one author.
- If one author query fails 3 times in a row, the remaining queued requests are stopped, while completed results remain visible in the page report.

## Configuration

The main app metadata is defined at the top of `app.js`, including:

- version number
- app title
- report title
- project link
- credit line

This makes future version updates and repository-link updates easier to maintain in one place.

Created by Tan, powered by Codex GPT-5.4, 04/2026
