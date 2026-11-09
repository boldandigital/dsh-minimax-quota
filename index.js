/**
 * @local/minimax-quota — host half.
 *
 * Serves the remaining MiniMax Token Plan quota to the browser half of this
 * plugin over the loopback Connection RPC channel. The API key is resolved
 * through the harness credential seam (`ctx.credentials`), so it never leaves
 * this process: the client receives already-normalized quota rows.
 *
 * Upstream endpoints (all accept a plain API key as `Authorization: Bearer`):
 *   international  https://api.minimax.io/v1/api/openplatform/coding_plan/remains
 *   international  https://www.minimax.io/v1/token_plan/remains
 *   china          https://api.minimaxi.com/v1/token_plan/remains
 *
 * The regions report the raw count fields differently: the international
 * endpoints report how much is LEFT, the China endpoint reports how much was
 * USED. The `*_remaining_percent` fields are region-independent, so those are
 * the values this plugin reports; the raw counts are only used to derive
 * "x of y left" and are interpreted per region.
 */

/** Service name this half registers on the plugin context. */
export const name = 'minimax-quota';

/** Host services this half needs. */
export const inject = ['connection', 'credentials'];

/** Connection's authenticated channel; the browser half calls into it. */
export const RPC_CHANNEL = '/api';

/** Method namespace owned by this plugin under {@link RPC_CHANNEL}. */
export const RPC_METHOD_PREFIX = 'minimax-quota';

/** RPC endpoints served by the host half. */
export const RPC_ENDPOINTS = ['quota'];

/** Method name the browser half sends for one endpoint. */
export function rpcMethod(endpoint) {
	return `${RPC_METHOD_PREFIX}/${endpoint}`;
}

/** Exact Fetch route path Connection serves one endpoint on. */
export function rpcRoutePath(endpoint) {
	return `${RPC_CHANNEL}/${rpcMethod(endpoint)}`;
}

/** Upstream fetch timeout. */
const UPSTREAM_TIMEOUT_MS = 15000;

/** Default credential reference, overridable from the bundle patch. */
const DEFAULT_CREDENTIAL_REF = 'MINIMAX_API_KEY';

/** Default refresh interval in milliseconds. */
const DEFAULT_REFRESH_MS = 60000;

/**
 * Upstream endpoints in probe order. The first one that answers with a
 * successful payload wins; the rest are only tried when it does not.
 */
const UPSTREAM_ENDPOINTS = [
	{ id: 'international', endpoint: 'https://api.minimax.io/v1/api/openplatform/coding_plan/remains', reportsUsed: false },
	{ id: 'international-www', endpoint: 'https://www.minimax.io/v1/token_plan/remains', reportsUsed: false },
	{ id: 'china', endpoint: 'https://api.minimaxi.com/v1/token_plan/remains', reportsUsed: true },
];

/** Failure result shape the client validates (`details` must be an object). */
function rpcError(code, message, details = {}) {
	return { ok: false, error: { code, message, details } };
}

/** Wrap one result in the server-response envelope Connection expects. */
function rpcEnvelope(rpcId, result, status = 200) {
	return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}

/**
 * Turn one upstream `model_remains` row into the shape the client renders.
 * @param {object} row - one entry of the upstream `model_remains` array.
 * @param {boolean} reportsUsed - whether the raw counts mean used (CN) or remaining.
 */
function normalizeRow(row, reportsUsed) {
	const counts = (total, raw) => {
		if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(raw)) return null;
		const remaining = reportsUsed ? Math.max(0, total - raw) : Math.min(total, raw);
		return { total, remaining, used: total - remaining };
	};
	const percent = (value) => (Number.isFinite(value) ? value : null);
	return {
		model: typeof row.model_name === 'string' ? row.model_name : 'unknown',
		intervalPercent: percent(row.current_interval_remaining_percent),
		weeklyPercent: percent(row.current_weekly_remaining_percent),
		interval: counts(row.current_interval_total_count, row.current_interval_usage_count),
		weekly: counts(row.current_weekly_total_count, row.current_weekly_usage_count),
		intervalResetsAt: Number.isFinite(row.end_time) ? row.end_time : null,
		weeklyResetsAt: Number.isFinite(row.weekly_end_time) ? row.weekly_end_time : null,
		intervalMsLeft: Number.isFinite(row.remains_time) ? row.remains_time : null,
		weeklyMsLeft: Number.isFinite(row.weekly_remains_time) ? row.weekly_remains_time : null,
	};
}

/**
 * Read the API key through the credential seam.
 * @returns {Promise<string|null>} the key, or null when it does not resolve.
 */
async function resolveCredential(ctx, ref) {
	try {
		const hit = await ctx.credentials.resolve(ref);
		if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value;
	} catch {
		// An unresolvable reference is reported to the caller as "no credential".
	}
	return null;
}

/**
 * Query MiniMax, trying each endpoint in order until one answers.
 * @returns {Promise<object>} normalized rows plus the endpoint that served them.
 */
async function fetchQuota(apiKey) {
	const failures = [];
	for (const candidate of UPSTREAM_ENDPOINTS) {
		let response;
		try {
			response = await fetch(candidate.endpoint, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'User-Agent': 'dsh-minimax-quota/0.1.0',
				},
				signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
			});
		} catch (error) {
			failures.push(`${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		if (!response.ok) {
			failures.push(`${candidate.id}: HTTP ${response.status}`);
			continue;
		}
		let payload;
		try {
			payload = await response.json();
		} catch {
			failures.push(`${candidate.id}: response was not JSON`);
			continue;
		}
		const statusCode = payload && payload.base_resp && payload.base_resp.status_code;
		if (statusCode !== undefined && statusCode !== 0) {
			const statusMsg = (payload.base_resp && payload.base_resp.status_msg) || 'unknown error';
			failures.push(`${candidate.id}: ${statusMsg} (code ${statusCode})`);
			continue;
		}
		const rawRows = Array.isArray(payload && payload.model_remains) ? payload.model_remains : [];
		return {
			endpoint: candidate.id,
			rows: rawRows.map((row) => normalizeRow(row, candidate.reportsUsed)),
		};
	}
	const detail = failures.join('; ');
	return { endpoint: null, rows: [], error: detail };
}

/**
 * Apply the plugin: normalize config and mount the RPC routes.
 *
 * Route registrations belong to the caller fiber and are disposed with it.
 * They ride Connection's exact Fetch registry rather than
 * `connection.rpc.handle`: in DSH 0.1.5+ that channel's disposer resolves
 * `owner.webServer` against the Connection plugin's own fiber, which never
 * holds `webServer`, so a third-party channel throws inside a child fiber
 * and vanishes without a boot error.
 *
 * @param {object} ctx - plugin context with connection and credentials services.
 * @param {object} config - raw plugin config from the bundle patch.
 */
export function apply(ctx, config = {}) {
	const raw = config && typeof config === 'object' ? config : {};
	const refreshMs = Number.isFinite(raw.refreshMs) && raw.refreshMs >= 5000 ? raw.refreshMs : DEFAULT_REFRESH_MS;
	const credentialRef =
		typeof raw.credentialRef === 'string' && /^[A-Z][A-Z0-9_]*$/.test(raw.credentialRef)
			? raw.credentialRef
			: DEFAULT_CREDENTIAL_REF;

	const handleRpc = async (endpoint, payload) => {
		try {
			if (endpoint !== 'quota') {
				return rpcError('internal', `unknown endpoint: ${String(endpoint)}`);
			}
			const apiKey = await resolveCredential(ctx, credentialRef);
			if (!apiKey) {
				return rpcError(
					'credential-missing',
					`credential reference ${credentialRef} did not resolve; add it to the DSH credential store`,
				);
			}
			const result = await fetchQuota(apiKey);
			if (result.error) {
				return rpcError('upstream', `MiniMax quota unavailable: ${result.error}`);
			}
			return {
				ok: true,
				value: {
					rows: result.rows,
					endpoint: result.endpoint,
					refreshMs,
					credentialRef,
					fetchedAt: Date.now(),
				},
			};
		} catch (error) {
			return rpcError('internal', error instanceof Error ? error.message : String(error));
		}
	};

	for (const endpoint of RPC_ENDPOINTS) {
		ctx.connection.fetch.register({
			path: rpcRoutePath(endpoint),
			methods: ['POST'],
			requestBody: 'buffered',
			fetch: async (request) => {
				const contentType = (request.headers.get('content-type') ?? '')
					.split(';', 1)[0]
					.trim()
					.toLowerCase();
				if (contentType !== 'application/json') {
					return new Response(
						JSON.stringify({
							type: 'server-response',
							rpcId: 'unknown',
							result: rpcError('gateway/bad-request', 'content type must be application/json'),
						}),
						{ status: 415, headers: { 'content-type': 'application/json' } },
					);
				}
				let message;
				try {
					message = await request.json();
				} catch {
					return new Response(
						JSON.stringify({
							type: 'server-response',
							rpcId: 'unknown',
							result: rpcError('gateway/bad-request', 'body is not JSON'),
						}),
						{ status: 400, headers: { 'content-type': 'application/json' } },
					);
				}
				const rpcId =
					message && typeof message === 'object' && typeof message.rpcId === 'string' ? message.rpcId : 'unknown';
				const expected = rpcMethod(endpoint);
				if (!message || message.type !== 'client-request' || message.method !== expected) {
					return rpcEnvelope(
						rpcId,
						rpcError('gateway/bad-request', `method must be ${JSON.stringify(expected)}`),
						400,
					);
				}
				try {
					return rpcEnvelope(rpcId, await handleRpc(endpoint, message.payload));
				} catch (error) {
					return rpcEnvelope(rpcId, rpcError('internal', error instanceof Error ? error.message : String(error)));
				}
			},
		});
	}
}
