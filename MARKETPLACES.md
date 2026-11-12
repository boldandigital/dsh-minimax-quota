# Where this plugin is published

Three channels, all reachable today. This file records what each one needs,
so nothing has to be rediscovered later.

## 1. npm — the install path

This package is published on npm as [`dsh-minimax-quota`](https://www.npmjs.com/package/dsh-minimax-quota).

```sh
dsh plugin --profile web add dsh-minimax-quota
```

npm is the channel the harness itself resolves: `dsh plugin add <name>` looks
a package name up in the registry, and the plugin market index format's
`source: { "type": "npm" }` points at a registry version with its publish time
and its `engines.dsh`.

| | |
|---|---|
| Package name | `dsh-minimax-quota` |
| Registry owner | the npm account that published it |
| Author field | `boldandigital (https://github.com/boldandigital)` |
| Versions | `0.1.0` |

The npm **name** is permanent: npm only allows an unpublish within 72 hours
of a release, and the name stays reserved afterwards. Publishing `0.1.1` and
later is the only way forward.

## 2. The plugin market index — the Discover tab

The index is its own repository, published with GitHub Pages:

```text
https://boldandigital.github.io/dsh-plugin-index/index.json
```

Add it under **Plugins → Discover → Manage index sources**, then the plugin
appears in the Discover tab with its icon, its description and its detail
document, and one click installs it.

The index follows the market format version 1 and is validated with
`@deepseek-ai/dsh-plugin-market-index`, the same validator the harness uses.
A daily workflow rebuilds it from the npm registry, so it never names a version
the registry does not have.

## 3. dsh-plugin.org — the community hub

A third-party hub, not affiliated with DeepSeek. It has no submission form and
no public listing repository: **the crawler finds plugins by GitHub topic**.

- The repository carries the `dsh-plugin` topic.
- The root `package.json` names the package and points `repository` at this
  owner/repo, which is what binds the npm package to the listing.
- The README carries the install command.
- The submission issue asks a human for the category and flips the entry from
  *unconfirmed* to *verified*.

The entry appears on the site once the crawler has run. The badge
`[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/boldandigital/dsh-minimax-quota)`
is added to this README at that point — the badge file itself is served for
every URL, so adding it earlier would claim a listing that does not exist.

## 4. Two things that need a person

| What | Who | How |
|---|---|---|
| The `hostsalt` account | a hostsalt.com super-admin | Authorise client id for MiniMax API access under the appropriate console. |
| The npm package owner line (optional) | the npm account holder | The organisation **boldandigital** exists, but npm only lets a *change of owners* happen with real two-factor authentication. Configure a 2FA method at <https://www.npmjs.com/settings/larsvonhierblau/tfa>, then the owner change in the browser at the package's **Admin** tab. **It is optional.** The package works, the index lists it, and the author field already says `boldandigital`; only npm's *maintainer* line is still the personal account. |

## Releasing a new version

The version in `package.json` is what npm publishes, and a release is a tag:

```sh
npm version patch     # 0.1.0 -> 0.1.1
git tag v0.1.1 && git push origin main --tags
```

**Releases are published by hand, not by CI.** The workflow in
`.github/workflows/publish.yml` publishes the tagged version over OIDC, but the
npm trusted publisher for this package is not configured yet, so the workflow
fails with `E404 ... you do not have permission to access it`. The npm token
in `~/.npmrc` is a granular token that bypasses 2FA, and npm refuses to let
such a token configure the trusted publisher:

```text
E403 Granular access tokens that bypass two-factor authentication may not
perform this action.
```

So the release is `npm publish --access public` from a clean checkout, and the
tag is pushed afterwards. The failed CI run on a tag is expected and harmless
— it does not publish anything.

Configuring the trusted publisher needs a person, because it needs a 2FA
session in the browser: **Package → Settings → Trusted Publisher**, pointing at
`boldandigital/dsh-minimax-quota`, the workflow file
`.github/workflows/publish.yml`, and the `publish` permission. The equivalent
CLI is:

```sh
npm trust github dsh-minimax-quota --file publish.yml \
  --repo boldandigital/dsh-minimax-quota --allow-publish
```

which asks for confirmation and then fails with the 403 above when run with
the current token.
