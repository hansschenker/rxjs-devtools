export const PANEL_STYLES = `
.rxdt {
  --rxdt-accent: #c2185b;
  --rxdt-bg: #ffffff;
  --rxdt-fg: #1f1f1f;
  --rxdt-muted: #6b6b6b;
  --rxdt-border: #e3e3e3;
  --rxdt-row: #f6f6f6;
  --rxdt-current: #fce4ec;
  --rxdt-error: #c62828;
  --rxdt-mono: ui-monospace, "Cascadia Code", Consolas, monospace;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 240px;
  box-sizing: border-box;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--rxdt-fg);
  background: var(--rxdt-bg);
  border: 1px solid var(--rxdt-border);
  border-radius: 6px;
  overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .rxdt {
    --rxdt-bg: #1b1b1f;
    --rxdt-fg: #e6e6e6;
    --rxdt-muted: #9a9a9a;
    --rxdt-border: #34343a;
    --rxdt-row: #232328;
    --rxdt-current: #4a1630;
    --rxdt-error: #ef5350;
  }
}
.rxdt * { box-sizing: border-box; }
.rxdt-header, .rxdt-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  flex-wrap: wrap;
}
.rxdt-header { border-bottom: 1px solid var(--rxdt-border); }
.rxdt-footer { border-top: 1px solid var(--rxdt-border); }
.rxdt-icon svg { width: 20px; height: 20px; display: block; }
.rxdt-title { font-weight: 600; color: var(--rxdt-accent); white-space: nowrap; }
.rxdt-select, .rxdt-filter {
  font: inherit;
  color: inherit;
  background: var(--rxdt-bg);
  border: 1px solid var(--rxdt-border);
  border-radius: 4px;
  padding: 3px 6px;
}
.rxdt-toolbar { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
.rxdt button {
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  color: var(--rxdt-accent);
  background: transparent;
  border: 1px solid var(--rxdt-accent);
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
}
.rxdt button:disabled { opacity: 0.4; cursor: default; }
.rxdt button.is-on { background: var(--rxdt-accent); color: #fff; }
.rxdt-main {
  display: grid;
  grid-template-columns: minmax(220px, 2fr) 3fr;
  flex: 1;
  min-height: 0;
}
.rxdt-actions {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--rxdt-border);
  min-height: 0;
}
.rxdt-filter { margin: 6px; }
.rxdt-list { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
.rxdt-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--rxdt-border);
  cursor: pointer;
}
.rxdt-row:hover { background: var(--rxdt-row); }
.rxdt-row.is-current { background: var(--rxdt-current); }
.rxdt-row.is-selected { outline: 2px solid var(--rxdt-accent); outline-offset: -2px; }
.rxdt-row.is-skipped .rxdt-row-type { text-decoration: line-through; opacity: 0.55; }
.rxdt-row.has-error .rxdt-row-type { color: var(--rxdt-error); }
.rxdt-row-id { color: var(--rxdt-muted); font-size: 11px; min-width: 2ch; text-align: right; }
.rxdt-row-type {
  font-family: var(--rxdt-mono);
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rxdt-row-time { color: var(--rxdt-muted); font-size: 11px; white-space: nowrap; }
.rxdt-row-actions { display: none; gap: 4px; }
.rxdt-row:hover .rxdt-row-actions, .rxdt-row.is-selected .rxdt-row-actions { display: flex; }
.rxdt-details { display: flex; flex-direction: column; min-height: 0; }
.rxdt-tabs { display: flex; gap: 4px; padding: 6px; border-bottom: 1px solid var(--rxdt-border); }
.rxdt-detail {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 8px 10px;
  font-family: var(--rxdt-mono);
  font-size: 12px;
}
.rxdt-detail pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
.rxdt-error { color: var(--rxdt-error); margin-bottom: 8px; }
.rxdt-diff { width: 100%; border-collapse: collapse; }
.rxdt-diff td { padding: 3px 6px; border-bottom: 1px solid var(--rxdt-border); vertical-align: top; }
.rxdt-diff .added { color: #2e7d32; }
.rxdt-diff .removed { color: var(--rxdt-error); }
.rxdt-diff .changed { color: #ef6c00; }
.rxdt-slider { flex: 1; min-width: 120px; accent-color: var(--rxdt-accent); }
.rxdt-status { color: var(--rxdt-muted); font-size: 12px; white-space: nowrap; }
.rxdt-empty { padding: 16px; color: var(--rxdt-muted); }
`;
