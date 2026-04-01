// Created by Tan, powered by Codex GPT-5.4, 04/2026

const APP_VERSION = "v0.1";
const APP_NAME = "INSPIRE-HEP Author Tracker";
const APP_TITLE = "INSPIRE-HEP Author Tracker";
const REPORT_TITLE = "INSPIRE-HEP Tracked Authors Report";
const PROJECT_LINK = "https://github.com/Regulust/INSPIRE-HEP-Author-Tracker";
const API_DOCS_LINK = "https://github.com/inspirehep/rest-api-doc";
const LICENSE_NAME = "CC BY 4.0";
const LICENSE_LINK = "https://creativecommons.org/licenses/by/4.0/";
const APP_CREDIT = "Created by Tan, powered by Codex GPT-5.4, 04/2026";

const API_URL = "https://inspirehep.net/api/literature";
const AUTHORS_API_BASE_URL = "https://inspirehep.net/api/authors";
const DEFAULT_DAYS = 30;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_REQUESTS_PER_WINDOW = 10;
const RATE_WINDOW_MS = 5000;
const RETRY_DELAY_MS = 5000;
const MAX_RETRIES_PER_AUTHOR = 3;

const state = {
  activeReportHtml: "",
  running: false,
  rateWindowTimestamps: [],
  activeControllers: new Set(),
};

const elements = {
  authorsFile: document.getElementById("authors-file"),
  authorsInput: document.getElementById("authors-input"),
  daysInput: document.getElementById("days-input"),
  startDateInput: document.getElementById("start-date-input"),
  endDateInput: document.getElementById("end-date-input"),
  recentDaysFields: document.getElementById("recent-days-fields"),
  dateRangeFields: document.getElementById("date-range-fields"),
  queryButton: document.getElementById("query-button"),
  resetButton: document.getElementById("reset-button"),
  downloadButton: document.getElementById("download-button"),
  statusBox: document.getElementById("status-box"),
  errorBox: document.getElementById("error-box"),
  reportRoot: document.getElementById("report-root"),
  resultMeta: document.getElementById("result-meta"),
  versionPrefix: document.getElementById("version-prefix"),
  modeInputs: Array.from(document.querySelectorAll('input[name="query-mode"]')),
};

elements.authorsFile.addEventListener("change", handleFileUpload);
elements.queryButton.addEventListener("click", handleQuery);
elements.resetButton.addEventListener("click", resetView);
elements.downloadButton.addEventListener("click", downloadReport);
elements.modeInputs.forEach(function (input) {
  input.addEventListener("change", syncQueryModeFields);
});

initializeDateInputs();
syncQueryModeFields();
setAppMetadata();

function setStatus(message) {
  elements.statusBox.textContent = message;
}

function setAppMetadata() {
  document.title = `${APP_TITLE} ${APP_VERSION}`;
  elements.versionPrefix.textContent = `${APP_VERSION}:`;
  elements.versionPrefix.classList.add("version-prefix");
}

function showError(message) {
  elements.errorBox.textContent = message;
  elements.errorBox.classList.remove("hidden");
}

function clearError() {
  elements.errorBox.textContent = "";
  elements.errorBox.classList.add("hidden");
}

function setRunning(running) {
  state.running = running;
  elements.queryButton.disabled = running;
  elements.resetButton.disabled = running;
  elements.authorsFile.disabled = running;
  elements.daysInput.disabled = running;
  elements.startDateInput.disabled = running;
  elements.endDateInput.disabled = running;
  elements.modeInputs.forEach(function (input) {
    input.disabled = running;
  });
  elements.downloadButton.disabled = running || !state.activeReportHtml;
}

function formatDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function initializeDateInputs() {
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - DEFAULT_DAYS);
  const todayValue = formatDateInputValue(today);

  elements.startDateInput.value = formatDateInputValue(defaultStart);
  elements.endDateInput.value = todayValue;
  elements.startDateInput.max = todayValue;
  elements.endDateInput.max = todayValue;
}

function getSelectedQueryMode() {
  const selected = elements.modeInputs.find(function (input) {
    return input.checked;
  });
  return selected ? selected.value : "recent";
}

function syncQueryModeFields() {
  const mode = getSelectedQueryMode();
  elements.recentDaysFields.classList.toggle("hidden", mode !== "recent");
  elements.dateRangeFields.classList.toggle("hidden", mode !== "range");
}

function cancelActiveRequests() {
  state.activeControllers.forEach(function (controller) {
    controller.abort();
  });
  state.activeControllers.clear();
}

async function handleFileUpload(event) {
  const fileList = event.target && event.target.files ? event.target.files : [];
  const file = fileList[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    elements.authorsInput.value = text.trim();
    setStatus(`Loaded ${file.name}. Ready to query.`);
  } catch (error) {
    showError(`Failed to read file: ${error.message}`);
  }
}

function resetView() {
  if (state.running) {
    return;
  }

  elements.authorsFile.value = "";
  elements.authorsInput.value = "";
  elements.daysInput.value = String(DEFAULT_DAYS);
  initializeDateInputs();
  elements.modeInputs.forEach(function (input) {
    input.checked = input.value === "recent";
  });
  syncQueryModeFields();
  elements.reportRoot.className = "report-root empty";
  elements.reportRoot.textContent = "Report output will appear here after a successful query.";
  elements.resultMeta.textContent = "No report generated yet.";
  state.activeReportHtml = "";
  elements.downloadButton.disabled = true;
  clearError();
  setStatus("Ready. Paste authors or upload a file to start.");
}

function parseAuthors(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (!lines.length) {
    throw new Error("Please provide at least one valid author line.");
  }

  return lines.map((line, index) => {
    const parts = line.split(",");
    if (parts.length < 2) {
      throw new Error(`Invalid line ${index + 1}: expected 'Name,https://inspirehep.net/authors/<recid>'`);
    }

    const name = parts[0].trim();
    const url = parts.slice(1).join(",").trim();
    const recidMatch = url.match(/\/authors\/(\d+)/);
    if (!name || !recidMatch) {
      throw new Error(`Invalid line ${index + 1}: missing author name or INSPIRE-HEP recid URL`);
    }

    return {
      name,
      url,
      recid: recidMatch[1],
    };
  });
}

function sanitizeText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAuthorName(fullName) {
  const parts = fullName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts.slice(1).join(" ")} ${parts[0]}`.trim();
  }
  return fullName.trim() || "N/A";
}

function getAuthorsLine(metadata) {
  const names = (metadata.authors || [])
    .map((author) => author.full_name)
    .filter(Boolean)
    .map(formatAuthorName);

  if (!names.length) {
    return "N/A";
  }

  const visible = names.slice(0, 5);
  return names.length > 5 ? `${visible.join(", ")}, et al.` : visible.join(", ");
}

function getTitle(metadata) {
  const titles = metadata && metadata.titles ? metadata.titles : [];
  return (titles[0] && titles[0].title) || "N/A";
}

function getSubmittedDate(metadata) {
  return metadata.preprint_date || metadata.legacy_creation_date || "N/A";
}

function getArxivInfo(metadata) {
  const arxivEntries = metadata && metadata.arxiv_eprints ? metadata.arxiv_eprints : [];
  const eprint = arxivEntries.find(function (item) {
    return item && item.value;
  });
  return {
    arxivId: eprint ? eprint.value : null,
    categories: eprint && eprint.categories ? eprint.categories : [],
  };
}

function getInspireLink(hit) {
  const controlNumber = hit.metadata && hit.metadata.control_number;
  if (controlNumber) {
    return `https://inspirehep.net/literature/${controlNumber}`;
  }
  return (hit.links && hit.links.html) || null;
}

function getPaperIdentifier(hit) {
  const metadata = hit.metadata || {};
  const { arxivId } = getArxivInfo(metadata);
  if (arxivId) {
    return `arxiv:${arxivId}`;
  }
  if (metadata.control_number) {
    return `inspire:${metadata.control_number}`;
  }
  return `fallback:${getTitle(metadata)}|${getSubmittedDate(metadata)}`;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function checkAuthorRecordExists(author) {
  const response = await fetch(`${AUTHORS_API_BASE_URL}/${author.recid}`);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`Author lookup failed for ${author.name}: HTTP ${response.status}`);
  }
  return true;
}

function buildQueryWindow() {
  const mode = getSelectedQueryMode();
  const today = new Date();
  const todayValue = formatDateInputValue(today);

  if (mode === "range") {
    const startDate = elements.startDateInput.value;
    const endDate = elements.endDateInput.value;

    if (!startDate || !endDate) {
      throw new Error("Please provide both start date and end date.");
    }
    if (startDate > endDate) {
      throw new Error("Start date cannot be later than end date.");
    }
    if (endDate > todayValue) {
      throw new Error("End date cannot be later than today.");
    }

    return {
      mode,
      daysLabel: `${startDate} to ${endDate}`,
      startDate,
      endDate,
    };
  }

  const daysValue = Number.parseInt(elements.daysInput.value, 10);
  const days = Number.isInteger(daysValue) && daysValue > 0 ? daysValue : DEFAULT_DAYS;
  elements.daysInput.value = String(days);

  const startDateObject = new Date(today);
  startDateObject.setDate(startDateObject.getDate() - days);

  return {
    mode,
    daysLabel: `Last ${days}`,
    startDate: formatDateInputValue(startDateObject),
    endDate: todayValue,
  };
}

async function waitForRateLimitSlot(progressMessage) {
  while (true) {
    const now = Date.now();
    state.rateWindowTimestamps = state.rateWindowTimestamps.filter(
      (timestamp) => now - timestamp < RATE_WINDOW_MS,
    );

    if (state.rateWindowTimestamps.length < MAX_REQUESTS_PER_WINDOW) {
      state.rateWindowTimestamps.push(now);
      return;
    }

    const waitMs = RATE_WINDOW_MS - (now - state.rateWindowTimestamps[0]) + 50;
    setStatus(`${progressMessage} Rate limit guard active, waiting ${(waitMs / 1000).toFixed(1)}s...`);
    await sleep(waitMs);
  }
}

async function fetchAuthorPapers(author, startDate, endDate, authorIndex, totalAuthors) {
  const query = `authors.recid:${author.recid} and earliest_date:${startDate}->${endDate}`;
  const params = new URLSearchParams({ q: query, size: "100" });

  for (let attempt = 1; attempt <= MAX_RETRIES_PER_AUTHOR; attempt += 1) {
    const progressMessage = `Querying author ${authorIndex}/${totalAuthors}: ${author.name}.`;
    setStatus(
      attempt === 1
        ? `${progressMessage} Please wait...`
        : `${progressMessage} Retry ${attempt}/${MAX_RETRIES_PER_AUTHOR}...`,
    );

    await waitForRateLimitSlot(progressMessage);

    let response;
    const controller = new AbortController();
    state.activeControllers.add(controller);
    try {
      response = await fetch(`${API_URL}?${params.toString()}`, {
        signal: controller.signal,
      });
    } catch (error) {
      state.activeControllers.delete(controller);
      if (error && error.name === "AbortError") {
        throw new Error(`Query cancelled while processing ${author.name}.`);
      }
      if (attempt === MAX_RETRIES_PER_AUTHOR) {
        throw new Error(`Network error while querying ${author.name}: ${error.message}`);
      }
      setStatus(`${progressMessage} Network error, waiting 5s before retry...`);
      await sleep(RETRY_DELAY_MS);
      continue;
    } finally {
      state.activeControllers.delete(controller);
    }

    if (response.status === 429) {
      if (attempt === MAX_RETRIES_PER_AUTHOR) {
        throw new Error(`Rate limit exceeded for ${author.name} after ${MAX_RETRIES_PER_AUTHOR} attempts.`);
      }
      setStatus(`${progressMessage} HTTP 429 received, waiting 5s before retry...`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    if (!response.ok) {
      if (attempt === MAX_RETRIES_PER_AUTHOR) {
        throw new Error(`Query failed for ${author.name}: HTTP ${response.status}`);
      }
      setStatus(`${progressMessage} HTTP ${response.status}, waiting 5s before retry...`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    const data = await response.json();
    return (data.hits && data.hits.hits) || [];
  }

  throw new Error(`Query failed for ${author.name} after ${MAX_RETRIES_PER_AUTHOR} attempts.`);
}

async function runQueryQueue(authors, startDate, endDate) {
  const results = new Array(authors.length);
  let nextIndex = 0;
  let abortError = null;

  async function worker() {
    while (nextIndex < authors.length && !abortError) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const author = authors[currentIndex];
      try {
        const papers = await fetchAuthorPapers(author, startDate, endDate, currentIndex + 1, authors.length);
        if (!papers.length) {
          const authorExists = await checkAuthorRecordExists(author);
          if (!authorExists) {
            results[currentIndex] = {
              author,
              papers: [],
              warning: "Author record not found on INSPIRE-HEP. Please check the author's link or <recid>.",
            };
            continue;
          }
        }
        results[currentIndex] = { author, papers };
      } catch (error) {
        results[currentIndex] = { author, papers: [], error: error.message };
        if (!abortError) {
          abortError = new Error(
            `Query stopped at author ${currentIndex + 1}/${authors.length} (${author.name}). ${error.message}`,
          );
          cancelActiveRequests();
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_REQUESTS, authors.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return { results, abortError };
}

function renderReport({ authors, days, startDate, endDate, queryTime, results, abortError }) {
  const uniquePaperIds = new Set();
  let totalEntries = 0;
  const expandedResults = [];
  const compactResults = [];

  results.filter(Boolean).forEach(function (entry) {
    if (entry.papers && entry.papers.length) {
      expandedResults.push(entry);
    } else {
      compactResults.push(entry);
    }
  });

  const authorSections = expandedResults
    .map(({ author, papers }, authorIndex) => {
      totalEntries += papers.length;
      papers.forEach((paper) => uniquePaperIds.add(getPaperIdentifier(paper)));
      const authorPaperCount = papers.length;

      const paperHtml = papers.length
        ? papers
            .map((paper, paperIndex) => {
              const metadata = paper.metadata || {};
              const title = sanitizeText(getTitle(metadata));
              const authorsLine = sanitizeText(getAuthorsLine(metadata));
              const submittedDate = sanitizeText(getSubmittedDate(metadata));
              const { arxivId, categories } = getArxivInfo(metadata);
              const inspireLink = getInspireLink(paper);

              return `
                <article class="paper">
                  <h3>${paperIndex + 1}. ${title}</h3>
                  <ul class="paper-meta">
                    <li><strong>Authors:</strong> ${authorsLine}</li>
                    <li><strong>Submitted:</strong> ${submittedDate}</li>
                    ${
                      inspireLink
                        ? `<li><strong>INSPIRE-HEP:</strong> <a href="${sanitizeText(inspireLink)}" target="_blank" rel="noreferrer">Literature page</a></li>`
                        : ""
                    }
                    ${
                      arxivId
                        ? `<li><strong>arXiv:</strong> <a href="https://arxiv.org/abs/${sanitizeText(arxivId)}" target="_blank" rel="noreferrer">${sanitizeText(arxivId)}</a></li>`
                        : ""
                    }
                    ${
                      categories.length
                        ? `<li><strong>Categories:</strong> <code>${sanitizeText(categories.join(", "))}</code></li>`
                        : ""
                    }
                  </ul>
                </article>
              `;
            })
            .join("")
        : `<p>${
            error
              ? sanitizeText(`Query failed: ${error}`)
              : warning
                ? sanitizeText(warning)
                : "No new papers."
          }</p>`;

      return `
        <section>
          <h2><a class="author-heading-link" href="${sanitizeText(author.url)}" target="_blank" rel="noreferrer">${sanitizeText(author.name)}</a> <span class="author-paper-count">(${authorPaperCount})</span></h2>
          ${paperHtml}
        </section>
        ${authorIndex < expandedResults.length - 1 ? "<hr />" : ""}
      `;
    })
    .join("");

  const compactSectionHtml = compactResults.length
    ? `
      <section class="compact-section">
        <h2>No New Papers / Issues <span class="author-paper-count">(${compactResults.length})</span></h2>
        <ul class="compact-author-list">
          ${compactResults
            .map(function ({ author, error, warning }) {
              const message = error
                ? `Query failed: ${error}`
                : warning
                  ? warning
                  : "No new papers.";
              return `
                <li>
                  <a href="${sanitizeText(author.url)}" target="_blank" rel="noreferrer">${sanitizeText(author.name)}</a>
                  <span class="compact-author-note">${sanitizeText(message)}</span>
                </li>
              `;
            })
            .join("")}
        </ul>
      </section>
    `
    : "";

  const warningHtml = abortError
    ? `<div class="report-warning"><strong>Query stopped early.</strong> ${sanitizeText(abortError.message)}</div>`
    : "";

  const reportHtml = `
    <div class="report">
      <h1>${sanitizeText(REPORT_TITLE)}</h1>
      <p><strong>Query Time:</strong> ${sanitizeText(queryTime)}</p>
      <p><strong>Date Range:</strong> ${sanitizeText(startDate)} to ${sanitizeText(endDate)}</p>
      <p><strong>Query Window:</strong> ${sanitizeText(days)}</p>
      ${warningHtml}
      <div class="summary-grid">
        <div class="summary-card">
          <strong>Authors</strong>
          <span>${authors.length}</span>
        </div>
        <div class="summary-card">
          <strong>Author-paper entries</strong>
          <span>${totalEntries}</span>
        </div>
        <div class="summary-card">
          <strong>Unique papers</strong>
          <span>${uniquePaperIds.size}</span>
        </div>
      </div>
      ${authorSections}
      ${compactSectionHtml}
      <p class="report-credit">
        Report generated by
        <a href="${sanitizeText(PROJECT_LINK)}" target="_blank" rel="noreferrer">${sanitizeText(`${APP_NAME} ${APP_VERSION}`)}</a>.
        Licensed under
        <a href="${sanitizeText(LICENSE_LINK)}" target="_blank" rel="noreferrer">${sanitizeText(LICENSE_NAME)}</a>.
      </p>
    </div>
  `;

  return {
    reportHtml,
    totalEntries,
    uniquePaperCount: uniquePaperIds.size,
  };
}

const DOWNLOAD_REPORT_STYLES = `
  :root {
    --panel-border: rgba(91, 67, 36, 0.12);
    --text: #1f2933;
    --muted: #61707f;
    --accent: #9a3412;
    --accent-strong: #7c2d12;
    --accent-soft: #fdf2e8;
  }
  body {
    margin: 0;
    padding: 32px 20px 40px;
    font-family: "Avenir Next", "Segoe UI", sans-serif;
    color: var(--text);
    background: linear-gradient(180deg, #f8f3ea 0%, #f4efe5 100%);
  }
  .page-shell {
    max-width: 1100px;
    margin: 0 auto;
  }
  .panel {
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid var(--panel-border);
    border-radius: 24px;
    padding: 22px;
    box-shadow: 0 20px 40px rgba(64, 43, 14, 0.12);
  }
  .report {
    font-family: Georgia, "Times New Roman", serif;
    line-height: 1.62;
  }
  .report h1 {
    margin-top: 0;
    border-bottom: 2px solid rgba(91, 67, 36, 0.14);
    padding-bottom: 10px;
  }
  .report h2 {
    margin-top: 20px;
    margin-bottom: 8px;
    padding: 7px 10px;
    border-left: 5px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 10px;
    font-size: 1.2rem;
  }
  .report h3 {
    margin: 0 0 8px;
    font-size: 1rem;
    line-height: 1.35;
  }
  .author-paper-count {
    font-size: 0.92rem;
    color: var(--muted);
    font-weight: 400;
  }
  .author-heading-link {
    color: inherit;
    text-decoration: none;
  }
  .author-heading-link:hover,
  .author-heading-link:focus-visible {
    color: var(--accent-strong);
    text-decoration: underline;
  }
  .paper {
    padding: 10px 12px;
    margin: 0 0 10px;
    border: 1px solid rgba(91, 67, 36, 0.1);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.72);
  }
  .paper-meta {
    padding-left: 18px;
    margin: 0;
    font-size: 0.96rem;
  }
  .paper-meta li + li {
    margin-top: 4px;
  }
  .report hr {
    border: 0;
    border-top: 1px solid rgba(91, 67, 36, 0.16);
    margin: 18px 0;
  }
  .compact-section {
    margin-top: 16px;
  }
  .compact-author-list {
    margin: 0;
    padding-left: 18px;
    font-size: 0.95rem;
  }
  .compact-author-list li + li {
    margin-top: 6px;
  }
  .compact-author-note {
    color: var(--muted);
    margin-left: 6px;
  }
  .report a {
    color: var(--accent-strong);
  }
  .report-warning {
    border-left: 5px solid #f59e0b;
    background: #fffbeb;
    padding: 12px 14px;
    border-radius: 10px;
  }
  .report-credit {
    margin-top: 28px;
    font-family: "Avenir Next", "Segoe UI", sans-serif;
    font-size: 0.86rem;
    color: var(--muted);
  }
  .report-credit a {
    color: inherit;
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin: 18px 0 8px;
  }
  .summary-card {
    padding: 14px;
    border-radius: 16px;
    background: rgba(255, 248, 235, 0.82);
    border: 1px solid rgba(91, 67, 36, 0.12);
  }
  .summary-card strong {
    display: block;
    margin-bottom: 6px;
    color: var(--muted);
    font-size: 0.9rem;
  }
`;

async function handleQuery() {
  if (state.running) {
    return;
  }

  clearError();
  state.rateWindowTimestamps = [];
  cancelActiveRequests();

  let authors;
  try {
    authors = parseAuthors(elements.authorsInput.value.trim());
  } catch (error) {
    showError(error.message);
    return;
  }

  const queryWindow = buildQueryWindow();
  const startDate = queryWindow.startDate;
  const endDate = queryWindow.endDate;
  const queryTime = new Date().toLocaleString();

  setRunning(true);
  setStatus(`Preparing to query ${authors.length} author(s)...`);
  elements.resultMeta.textContent = "Query in progress...";
  elements.reportRoot.className = "report-root empty";
  elements.reportRoot.textContent = "Query in progress. Results will appear here when ready.";

  try {
    const { results, abortError } = await runQueryQueue(authors, startDate, endDate);
    const filteredResults = results.filter(Boolean);
    const { reportHtml, totalEntries, uniquePaperCount } = renderReport({
      authors,
      days: queryWindow.daysLabel,
      startDate,
      endDate,
      queryTime,
      results: filteredResults,
      abortError,
    });

    state.activeReportHtml = reportHtml;
    elements.downloadButton.disabled = false;
    elements.reportRoot.className = "report-root";
    elements.reportRoot.innerHTML = reportHtml;
    elements.resultMeta.textContent = `Completed ${filteredResults.length}/${authors.length} author(s). Entries: ${totalEntries}. Unique papers: ${uniquePaperCount}.`;
    setStatus(
      abortError
        ? `Stopped early. ${filteredResults.length} author(s) processed before termination.`
        : `Finished. ${authors.length} author(s) processed successfully.`,
    );

    if (abortError) {
      showError(abortError.message);
    }
  } catch (error) {
    elements.reportRoot.className = "report-root empty";
    elements.reportRoot.textContent = "The query did not complete.";
    elements.resultMeta.textContent = "No report generated.";
    showError(error.message);
    setStatus("Query failed.");
  } finally {
    cancelActiveRequests();
    setRunning(false);
  }
}

function buildDownloadDocument(reportHtml) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${REPORT_TITLE}</title>
    <style>${DOWNLOAD_REPORT_STYLES}</style>
  </head>
  <body>
    <div class="page-shell">
      <section class="panel result-panel">
        ${reportHtml}
      </section>
    </div>
  </body>
</html>`;
}

function downloadReport() {
  if (!state.activeReportHtml) {
    return;
  }

  const blob = new Blob([buildDownloadDocument(state.activeReportHtml)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "new_papers_report.html";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
