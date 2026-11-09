# dsh-minimax-quota

MiniMax Token Plan quota chip for the DeepSeek Harness web surface.

It registers one entry in the `conversation.composer.dock` slot — the row below
the composer card — so the remaining quota appears beside the "8.9M tok · Cache hit
91%" strip without touching the shipped UI.

```
● MiniMax 32%
```

Hovering the chip shows every window: the 5-hour and weekly remaining
percentage, the "x of y left" request counts where MiniMax reports them, and
the reset time for each window.

## How it works

Two halves, following the DSH client-plugin contract:

| Half | File | Role |
|---|---|---|
| Host | `lib/index.js` | Resolves the API key through the harness credential seam, queries MiniMax, normalizes the result |
| Client | `lib/client.js` | Renders the chip and registers it into the composer dock slot |

The browser never sees the API key. The client calls the host over the
loopback Connection RPC channel (`/api`, method namespace `minimax-quota`), and
the host returns already-normalized rows.

### Upstream endpoints

Tried in order; the first that answers wins:

| Region | Endpoint |
|---|---|
| international | `https://api.minimax.io/v1/api/openplatform/coding_plan/remains` |
| international | `https://www.minimax.io/v1/token_plan/remains` |
| china | `https://api.minimaxi.com/v1/token_plan/remains` |

All three accept a plain API key as `Authorization: Bearer <key>` — no admin
key required.

### The region reporting quirk

The international endpoints report `current_interval_usage_count` /
`current_weekly_usage_count` as **how much is left**; the China endpoint
reports **how much was used**. Naive subtraction therefore inverts the numbers
on one side. This plugin reads the region-independent
`*_remaining_percent` fields as the source of truth and only derives
"x of y left" from the counts, interpreting them per region.

## Configuration

In the profile's `cordis.patch.yml`:

```yaml
- id: minimax-quota
  name: 'dsh-minimax-quota'
  config:
    refreshMs: 60000
    credentialRef: MINIMAX_API_KEY
```

| Key | Default | Meaning |
|---|---|---|
| `refreshMs` | `60000` | How often the chip re-reads the quota (minimum 5000) |
| `credentialRef` | `MINIMAX_API_KEY` | Credential reference resolved through `ctx.credentials` |

The credential must exist in the DSH credential store
(`~/.dsh/.credentials.yaml`). It already does on this machine, so the chip
works with no further setup.

## Install

```bash
dsh plugin --profile desktop add \
  "link:/Users/lars/Documents/deepseek-harness/default-workspace/minimax-quota"
```

Or through the plugin manager:

```
plugin_manager install_bundle → link:/Users/lars/Documents/deepseek-harness/default-workspace/minimax-quota
```

After installing, **reload the GUI page** so the browser picks up the new
client module from the host's client graph.

## Also useful

`scripts/minimax-quota.mjs` in the workspace root prints the same quota from
the terminal, with a `--json` flag:

```bash
node scripts/minimax-quota.mjs
node scripts/minimax-quota.mjs --json
```

## Reference

The slot contract, the RPC envelope and the client-plugin shape were modelled
on the community plugin `dsh-quota-panel`, which uses `shell.overlay` instead
of the composer dock.

## npm

This package is also published on npm as [`dsh-minimax-quota`](https://www.npmjs.com/package/dsh-minimax-quota), so you can install it with:

```sh
dsh plugin --profile web add dsh-minimax-quota
npm install dsh-minimax-quota
```

The package name is permanent on npm. Publishing new versions follows the
standard `npm version patch` workflow with git tags.

## Marketplace

Add the plugin market index source under **Plugins → Discover → Manage index sources**:

```text
https://boldandigital.github.io/dsh-plugin-index/index.json
```

The index is rebuilt from the npm registry every morning, so it never points
at a version the registry does not have.
