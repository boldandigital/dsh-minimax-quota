/**
 * @local/minimax-quota — client half (browser bundle, served through the
 * `dsh.client` manifest).
 *
 * Registers one entry in the `conversation.composer.dock` slot: a compact
 * inline chip that sits beside the shipped UsagePill in the strip below the
 * composer card, showing the remaining MiniMax Token Plan quota.
 *
 * The chip is a plain React element built with inline styles against the
 * Harness design tokens (`--dsw-alias-*`, `--dsw-static-*`), so it follows the
 * product theme (light/dark) without carrying a stylesheet. Nothing is written
 * to the DOM outside the component.
 *
 * Data arrives over the loopback Connection RPC channel `/api` under the
 * `minimax-quota` method namespace, owned by the host half in lib/index.js.
 * The API key never reaches the browser.
 */
(function () {
	// The factory id MUST equal the package id. The module system resolves a
	// graph row's factory by its row id (`@local/minimax-quota`); registering
	// under a different id makes it look like the bundle "loaded without
	// registering", and the retry then trips the duplicate-factory guard.
	window.__ModuleLoader__.load({
		id: '@local/minimax-quota',
		factory: function (require) {
			var module = { exports: {} };
			var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
			var React = require('react');

			/** Connection's authenticated channel; the host half owns it. */
			var CHANNEL = '/api';

			/** Method namespace owned by this plugin under {@link CHANNEL}. */
			var RPC_METHOD_PREFIX = 'minimax-quota';

			/** Slot this plugin adds its entry to. */
			var SLOT_NAME = 'conversation.composer.dock';

			/** Own id inside the slot, beside the shipped entries. */
			var SLOT_ID = 'minimax-quota';

			/** Client services this half needs. */
			var inject = ['slots', 'connection'];

			var FALLBACK_REFRESH_MS = 60000;

			/** Remaining-percent → status dot colour. */
			function dotColor(percent) {
				if (percent === null || percent === undefined) {
					return 'var(--dsw-static-neutral-bluish-400, #9aa4b2)';
				}
				if (percent >= 50) return 'var(--dsw-static-green-500, #16a34a)';
				if (percent >= 20) return 'var(--dsw-static-amber-500, #f59e0b)';
				return 'var(--dsw-static-red-500, #ef4444)';
			}

			function formatReset(epochMs) {
				if (!epochMs) return 'unknown';
				try {
					return new Date(epochMs).toLocaleString(undefined, {
						dateStyle: 'medium',
						timeStyle: 'short',
					});
				} catch (error) {
					return 'unknown';
				}
			}

			function formatLeft(ms) {
				if (!Number.isFinite(ms) || ms <= 0) return '';
				var hours = Math.floor(ms / 3600000);
				var minutes = Math.floor((ms % 3600000) / 60000);
				if (hours > 0) return hours + 'h ' + minutes + 'm left';
				return minutes + 'm left';
			}

			/** Human label for an upstream model bucket. */
			function modelLabel(model) {
				if (model === 'general') return 'MiniMax';
				if (model === 'video') return 'MiniMax video';
				return model;
			}

			/**
			 * The window the chip displays. This is deliberately STUCK on the
			 * 5-hour window: comparing the two windows and showing whichever
			 * happens to be lower makes the chip flip between "5-hour" and
			 * "weekly" as the two drain at different rates, which reads as a
			 * broken widget. Only the 5-hour window is ever compared, and the
			 * weekly window is used solely as a fallback when no row reports
			 * a 5-hour percentage at all.
			 *
			 * @param {Array<object>} rows - normalized quota rows.
			 * @returns {object|null} the chosen window, or null when none is reported.
			 */
			function primaryWindow(rows) {
				var worstFiveHour = null;
				var weeklyFallback = null;

				rows.forEach(function (row) {
					if (row.intervalPercent !== null && row.intervalPercent !== undefined) {
						if (!worstFiveHour || row.intervalPercent < worstFiveHour.percent) {
							worstFiveHour = {
								percent: row.intervalPercent,
								row: row,
								win: {
									key: '5-hour',
									percent: row.intervalPercent,
									resetsAt: row.intervalResetsAt,
									msLeft: row.intervalMsLeft,
								},
							};
						}
					}
					if (
						!weeklyFallback &&
						row.weeklyPercent !== null &&
						row.weeklyPercent !== undefined
					) {
						weeklyFallback = {
							percent: row.weeklyPercent,
							row: row,
							win: {
								key: 'weekly',
								percent: row.weeklyPercent,
								resetsAt: row.weeklyResetsAt,
								msLeft: row.weeklyMsLeft,
							},
						};
					}
				});

				return worstFiveHour || weeklyFallback;
			}

			/** Full multi-line tooltip describing every row and window. */
			function buildTooltip(value) {
				var lines = ['MiniMax Token Plan quota', 'chip shows the 5-hour window'];
				var rows = (value && value.rows) || [];
				rows.forEach(function (row) {
					lines.push('');
					lines.push(modelLabel(row.model));
					if (row.intervalPercent !== null && row.intervalPercent !== undefined) {
						lines.push(
							'  5-hour: ' + row.intervalPercent + '% remaining' +
								(row.interval ? ' (' + row.interval.remaining + '/' + row.interval.total + ' left)' : '') +
								' — resets ' + formatReset(row.intervalResetsAt) +
								(row.intervalMsLeft ? ', ' + formatLeft(row.intervalMsLeft) : ''),
						);
					}
					if (row.weeklyPercent !== null && row.weeklyPercent !== undefined) {
						lines.push(
							'  weekly: ' + row.weeklyPercent + '% remaining' +
								(row.weekly ? ' (' + row.weekly.remaining + '/' + row.weekly.total + ' left)' : '') +
								' — resets ' + formatReset(row.weeklyResetsAt) +
								(row.weeklyMsLeft ? ', ' + formatLeft(row.weeklyMsLeft) : ''),
						);
					}
				});
				if (value && value.fetchedAt) {
					lines.push('');
					lines.push('updated ' + formatReset(value.fetchedAt));
				}
				return lines.join('\n');
			}

			/**
			 * Apply the plugin: register the composer-dock entry.
			 * @param {object} ctx - client plugin context.
			 */
			function apply(ctx) {
				var QuotaChip = function () {
					var state = React.useState(null);
					var snapshot = state[0];
					var setSnapshot = state[1];

					React.useEffect(function () {
						var alive = true;
						var timer = null;

						var load = function () {
							ctx.connection.rpc
								.call(CHANNEL, RPC_METHOD_PREFIX + '/quota', null)
								.then(function (result) {
									if (!alive) return;
									if (result && result.ok === true && result.value) {
										setSnapshot({ ok: true, value: result.value });
										var ms =
											Number.isFinite(result.value.refreshMs) && result.value.refreshMs >= 5000
												? result.value.refreshMs
												: FALLBACK_REFRESH_MS;
										if (timer === null) timer = setInterval(load, ms);
									} else {
										var message =
											(result && result.error && result.error.message) || 'quota unavailable';
										setSnapshot({ ok: false, message: message });
									}
								})
								.catch(function (error) {
									if (!alive) return;
									setSnapshot({
										ok: false,
										message: String((error && error.message) || error),
									});
								});
						};

						load();

						return function () {
							alive = false;
							if (timer !== null) {
								clearInterval(timer);
								timer = null;
							}
						};
					}, []);

					var chipStyle = {
						display: 'inline-flex',
						alignItems: 'center',
						gap: '6px',
						fontFamily: 'var(--dsw-font-family, inherit)',
						fontSize: '12px',
						lineHeight: '1',
						whiteSpace: 'nowrap',
						color: 'var(--dsw-alias-label-secondary, rgba(0, 0, 0, 0.62))',
					};

					if (!snapshot) {
						// Still loading: render nothing so the strip stays clean.
						return null;
					}

					if (!snapshot.ok) {
						return React.createElement(
							'span',
							{ style: chipStyle, title: 'MiniMax quota: ' + snapshot.message },
							React.createElement('span', {
								style: {
									width: '8px',
									height: '8px',
									borderRadius: '50%',
									display: 'inline-block',
									background: 'var(--dsw-static-neutral-bluish-400, #9aa4b2)',
								},
							}),
							React.createElement('span', null, 'MiniMax'),
							React.createElement('span', { style: { opacity: 0.7 } }, 'n/a'),
						);
					}

					var value = snapshot.value || {};
					var rows = value.rows || [];
					var worst = primaryWindow(rows);

					if (!worst) {
						return React.createElement(
							'span',
							{ style: chipStyle, title: 'MiniMax quota: no windows reported' },
							React.createElement('span', {
								style: {
									width: '8px',
									height: '8px',
									borderRadius: '50%',
									display: 'inline-block',
									background: 'var(--dsw-static-neutral-bluish-400, #9aa4b2)',
								},
							}),
							React.createElement('span', null, 'MiniMax'),
							React.createElement('span', { style: { opacity: 0.7 } }, 'n/a'),
						);
					}

					return React.createElement(
						'span',
						{ style: chipStyle, title: buildTooltip(value) },
						React.createElement('span', {
							style: {
								width: '8px',
								height: '8px',
								borderRadius: '50%',
								display: 'inline-block',
								background: dotColor(worst.percent),
							},
						}),
						React.createElement('span', null, 'MiniMax'),
						React.createElement('span', { style: { opacity: 0.7 } }, worst.win.key === '5-hour' ? '5h' : 'wk'),
						React.createElement('span', {
							style: {
								color: 'var(--dsw-alias-label-primary, inherit)',
								fontVariantNumeric: 'tabular-nums',
							},
						}, worst.percent + '%'),
					);
				};

				ctx.slots.inject(SLOT_NAME, function () {
					return ctx.slots.register(
						{
							name: SLOT_NAME,
							id: SLOT_ID,
							order: 100,
							label: 'MiniMax quota',
						},
						function () {
							return React.createElement(QuotaChip, null);
						},
					);
				});
			}

			exports.apply = apply;
			exports.inject = inject;
			return module.exports;
		},
	});
})();
