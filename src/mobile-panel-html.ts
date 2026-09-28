// Mobile panel HTML template (inline CSS + structure)
//
// Colour values use Joplin's live --joplin-* theme variables (injected by
// Joplin into plugin panels, so the panel follows the active theme) with
// light-theme fallbacks. Note: only variables Joplin actually emits —
// e.g. there is no --joplin-panel-border-color or --joplin-color-accent.
export const MOBILE_PANEL_HTML = `
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	body {
		font-family: var(--joplin-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
		font-size: 15px;
		background-color: var(--joplin-background-color, #f5f5f5);
		color: var(--joplin-color, #333);
	}
	/* Lock page scroll while the snooze dropdown is open (see mobile-webview.ts) */
	body.snooze-open {
		overflow: hidden;
	}
	.panel-header {
		padding: 14px 12px;
		font-size: 16px;
		font-weight: 600;
		border-bottom: 1px solid var(--joplin-divider-color, #e0e0e0);
		display: flex;
		align-items: center;
		justify-content: space-between;
		position: sticky;
		top: 0;
		background-color: var(--joplin-background-color, #f5f5f5);
		z-index: 10;
	}
	.task-count {
		background: var(--joplin-color-error, #e74c3c);
		color: white;
		padding: 2px 10px;
		border-radius: 12px;
		font-size: 13px;
		margin-left: 8px;
	}
	.content-area {
		padding: 10px 4px;
		padding-bottom: 88px;
	}
	/* Cards sit on --joplin-background-color3 so they stay distinct from
	   the panel background in every theme (background-color would be the
	   same as body and cards would only show their left border) */
	.task-card {
		background-color: var(--joplin-background-color3, #fff);
		color: var(--joplin-color, #333);
		padding: 10px 4px;
		display: flex;
		align-items: center;
		border-radius: 8px;
		margin-bottom: 8px;
		border-left: 5px solid #3498db;
		gap: 8px;
	}
	.task-card.overdue-high { border-left-color: var(--joplin-color-error, #e74c3c); }
	.task-card.overdue-medium { border-left-color: var(--joplin-color-warn, #e67e22); }
	.task-card.overdue-low { border-left-color: #3498db; }
	.task-card.upcoming { border-left-color: var(--joplin-color-correct, #27ae60); }
	.task-info { flex-grow: 1; min-width: 0; }
	.task-title {
		font-size: 15px;
		font-weight: 500;
		margin-bottom: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.3;
	}
	.task-time { font-size: 13px; opacity: 0.7; }
	.task-actions { display: flex; gap: 6px; flex-shrink: 0; }
	.action-btn {
		background-color: var(--joplin-selected-color, rgba(0,0,0,0.08));
		border: none;
		color: var(--joplin-color, #333);
		padding: 8px 10px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 16px;
		min-width: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.action-btn:active { background-color: var(--joplin-background-color-hover3, rgba(0,0,0,0.16)); }
	.empty-state {
		display: flex;
		flex-direction: column;
		text-align: center;
		align-items: center;
		justify-content: center;
		color: var(--joplin-color-faded, #888);
		padding: 20px;
		font-size: 15px;
		flex: 1;
		min-height: 0;
	}
	.empty-state-icon {
		font-size: 40px;
		margin-bottom: 12px;
		opacity: 0.5;
	}
	.panel-footer {
		padding: 6px 12px;
		border-top: 1px solid var(--joplin-divider-color, #e0e0e0);
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		gap: 8px;
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		height: 56px;
		background-color: var(--joplin-background-color, #f5f5f5);
		z-index: 10;
	}
	.footer-btn {
		background-color: var(--joplin-selected-color, #fff);
		border: 1px solid var(--joplin-divider-color, #ccc);
		padding: 10px 4px;
		font-size: 12px;
		color: var(--joplin-color, #333);
		cursor: pointer;
		border-radius: 6px;
		flex: 1;
		text-align: center;
		white-space: nowrap;
		line-height: 1.2;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
	}
	.footer-btn:active {
		background-color: var(--joplin-background-color-hover3, #e0e0e0);
	}
	.footer-btn.active {
		background-color: #3498db;
		color: white;
		border-color: #2980b9;
	}
	.footer-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.refresh-icon {
		display: inline-block;
	}
	.footer-btn.loading .refresh-icon {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}

	/* Snooze dropdown */
	#snoozeDropdown {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: var(--joplin-background-color, #fff);
		color: var(--joplin-color, #333);
		border: 1px solid var(--joplin-divider-color, #ccc);
		box-shadow: 0 4px 20px var(--joplin-shadow-color, rgba(0,0,0,0.3));
		border-radius: 10px;
		padding: 16px;
		width: calc(100vw - 32px);
		max-width: 320px;
		max-height: 90vh;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		z-index: 1000;
	}
	.snooze-title {
		font-weight: 600;
		margin-bottom: 10px;
		font-size: 15px;
	}
	.snooze-presets {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.snooze-option {
		padding: 15px 14px;
		cursor: pointer;
		border-radius: 6px;
		font-size: 15px;
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* Independent tab stops: instant presets vs. day presets (day names are shorter) */
	.snooze-option-name {
		width: 124px;
		flex-shrink: 0;
	}
	.snooze-option-name--day {
		width: 64px;
	}
	.snooze-option:active {
		background-color: #3498db;
		color: white;
	}
	.snooze-custom {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--joplin-divider-color, #eee);
	}
	.snooze-custom-label {
		font-size: 13px;
		color: var(--joplin-color-faded, #666);
		margin-bottom: 8px;
	}
	.snooze-custom-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.snooze-custom-input {
		width: 64px;
		padding: 8px 8px;
		border: 1px solid var(--joplin-divider-color, #ddd);
		border-radius: 6px;
		font-size: 13px;
		text-align: center;
		background: var(--joplin-background-color, #fff);
		color: var(--joplin-color, #333);
	}
	.snooze-custom-select {
		flex: 1;
		padding: 8px 8px;
		border: 1px solid var(--joplin-divider-color, #ddd);
		border-radius: 6px;
		font-size: 15px;
		background: var(--joplin-background-color, #fff);
		color: var(--joplin-color, #333);
	}
	.snooze-custom-btn {
		padding: 8px 14px;
		background: #3498db;
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 15px;
		white-space: nowrap;
	}
	.snooze-cancel {
		margin-top: 12px;
		width: 100%;
		padding: 12px;
		background: var(--joplin-selected-color, #f5f5f5);
		border: 1px solid var(--joplin-divider-color, #ddd);
		border-radius: 6px;
		cursor: pointer;
		font-size: 15px;
		color: var(--joplin-color, #333);
	}
</style>

<div class="panel-header">
	<span>
		On-Deck Reminders
		<span class="task-count" id="taskCount" style="display:none;">0</span>
	</span>
</div>
<div class="content-area">
	<div id="emptyState" class="empty-state">
		<div class="empty-state-icon">&#128203;</div>
		<div>Loading tasks...</div>
	</div>
	<div id="taskList"></div>
</div>
<div class="panel-footer">
	<button class="footer-btn" id="refreshBtn" title="Refresh"><span class="refresh-icon">&#8635;</span> Refresh</button>
	<button class="footer-btn" id="lookAheadBtn" title="Toggle look-ahead">Look Ahead: OFF</button>
	<button class="footer-btn" id="snoozeAllBtn">&#9201; Snooze All</button>
</div>
`;
