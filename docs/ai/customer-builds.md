# Customer builds

## Scope

`AIRI_BRAND_JSON` is the public identity source for Desktop, Pocket, and Web builds.
The schema is in `packages/stage-shared/src/brand/config.ts`.
The blank template is `brand.example.json` at the repository root.

Production builds reject missing fields, upstream identities, upstream destinations, and HTTP service URLs.
Development without this variable uses `Local Development`, isolated application IDs, and `http://localhost:3000`.
Development updates remain disabled unless the local update harness supplies `UPDATE_SERVER_URL`.
The template stays empty until the product owner supplies the customer values.

This change covers installation identity, local Desktop data, updates, authentication, legal links, and release destinations.
It does not replace logos, avatar assets, translated product text, or upstream source attribution.

## Configuration

| Field | Value |
| --- | --- |
| `productName` | Customer product name. Letters, digits, spaces, underscores, and hyphens are permitted. |
| `desktopAppId` | Unique reverse-domain Desktop ID. Use lowercase letters, digits, and dots. |
| `pocketAppId` | Unique Pocket ID for both Android and iOS. It must differ from the Desktop ID. |
| `callbackScheme` | Unique reverse-domain scheme for Pocket login callbacks. |
| `serverUrl` | Customer API URL with HTTPS. |
| `inferenceBaseUrl` | Optional. OpenAI-compatible chat endpoint of the customer gateway, with HTTPS. When it is set, onboarding hides the URL field, and customers enter only their key. |
| `inferenceModel` | Optional. Chat model that onboarding selects without a catalog request. When it is empty, onboarding selects the first model that the gateway lists. If the gateway lists none, onboarding shows an error and a retry. |
| `termsUrl` | Published customer terms URL with HTTPS. |
| `privacyUrl` | Published customer privacy URL with HTTPS. The server controls language selection. |
| `updateRepository` | Customer GitHub repository in `owner/repo` format. |
| `desktopOidcClientId` | Desktop client ID registered on the customer authentication service. |
| `pocketOidcClientId` | Pocket client ID registered on that service. |
| `webOidcClientId` | Web client ID registered on that service. |
| `itchTarget` | Customer itch project in `owner/project` format. An empty value disables itch uploads. |

The update repository must receive the release assets from the customer release workflows.
Architecture-specific update channels remain `latest-x64` and `latest-arm64`.
The production updater does not use `UPDATE_SERVER_URL`.
The old `VITE_SERVER_URL` and `VITE_OIDC_CLIENT_ID` variables no longer configure these stage clients.

1. Create a local configuration from the blank template.
2. Fill each required field with customer-owned values.
3. Export the JSON before each build or package command.

```sh
export AIRI_BRAND_JSON="$(cat brand.local.json)"
pnpm -F @proj-airi/stage-tamagotchi build:mac
```

For GitHub Actions, store the JSON in the repository variable `AIRI_BRAND_JSON`.
Keep credentials out of this variable. The application bundle contains this public configuration.
Turbo includes this variable in its cache keys.

## Native identity

Desktop uses the application ID as its data-directory name under Electron's application-data root.
The macOS app bundle and the Windows executable use the product name. The Linux executable uses the application ID for Flatpak.
It does not migrate or read the upstream Desktop data directory.
`APP_USER_DATA_PATH` remains an explicit development override.

Capacitor commands generate `android/brand.json` and `ios/brand.xcconfig` from the same configuration.
Android Gradle reads the generated file for its application ID, label, and callback scheme.
The Kotlin namespace stays unchanged. It identifies source classes, not the installed application.
iOS reads the generated build settings for its bundle ID, display name, callback scheme, and developer team.

Before a native build, run the matching Capacitor sync with the same environment as the web build.
Do not reuse generated native configuration from another customer.

```sh
pnpm -F @proj-airi/stage-pocket build
pnpm -F @proj-airi/stage-pocket exec cap sync android
pnpm -F @proj-airi/stage-pocket exec cap build android
```

Flatpak builds generate their manifest, desktop entry, and AppStream metadata from the same identity.
Generated native and Flatpak files are not committed.

## Authentication

Deploy the customer authentication service before a customer release.
The auth UI accepts an `api_server_url` redirect value only for the `serverUrl` host or a localhost server.
Register all three client IDs and their redirect URLs there.
Pocket uses `<callbackScheme>://links/auth/callback`.
Desktop uses `<serverUrl>/api/auth/oidc/electron-callback` with its local loopback receiver.
Web uses the deployment origin and `/auth/callback`, unless `VITE_OIDC_REDIRECT_URI` explicitly selects another origin.

## Signing

Desktop packaging requires code signing on macOS and Windows.
macOS also requires hardened runtime and notarization.
Packaging rejects missing notarization credentials instead of accepting Electron Builder's default skip behavior.
The release workflow no longer uses the upstream SignPath project or an unsigned fallback.

| Target | Required credentials |
| --- | --- |
| Desktop macOS workflow | `CSC_CONTENT`, `CSC_KEY_PASSWORD`, `APPLE_DEVELOPER_APPLE_ID`, `APPLE_DEVELOPER_APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_DEVELOPER_TEAM_ID` |
| Desktop macOS local build | `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Desktop Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`. Electron Builder accepts a certificate URL or base64 certificate. |
| Pocket Android | Existing `CAPACITOR_ANDROID_KEYSTORE_*` credentials for the customer keystore. |
| Pocket iOS | Customer distribution certificate, provisioning profile, and `APPLE_TEAM_ID`. CI maps the developer-team secret to this variable. |

For a local test without certificates, set `AIRI_ALLOW_UNSIGNED=1` and package only an app directory.
This mode skips the signing and notarization checks. It rejects installer targets, and CI ignores it.
Do not give an unsigned app directory to customers.

```sh
export AIRI_BRAND_JSON="$(cat brand.local.json)"
AIRI_ALLOW_UNSIGNED=1 pnpm -F @proj-airi/stage-tamagotchi build:unpack
```

Certificates must belong to the customer publisher and match the application identifiers.
Local Pocket iOS release builds also need a customer provisioning profile selected in Xcode.
The iOS workflow reads the UUID from the supplied provisioning profile for archive and export operations.
Signing does not guarantee that Windows SmartScreen immediately trusts a new publisher.
A real signed installation and update test is necessary before customer delivery.

## Validation record

The following commands ran for this change. The pnpm flag disables automatic dependency installation before commands.

```sh
pnpm --config.verifyDepsBeforeRun=false -F @proj-airi/stage-shared typecheck
pnpm --config.verifyDepsBeforeRun=false typecheck --continue=always --concurrency=2
pnpm --config.verifyDepsBeforeRun=false lint
pnpm --config.verifyDepsBeforeRun=false -C packages/stage-shared exec vitest run --project stage-shared-node src/brand/config.test.ts
pnpm --config.verifyDepsBeforeRun=false exec vitest run --config apps/stage-tamagotchi/vitest.node.config.ts apps/stage-tamagotchi/src/main/services/electron/auto-updater.test.ts apps/stage-tamagotchi/src/main/services/airi/auth.test.ts
pnpm --config.verifyDepsBeforeRun=false -C packages/stage-ui exec vitest run --project node src/composables/use-analytics.test.ts src/libs/auth-fetch.test.ts
pnpm --config.verifyDepsBeforeRun=false -C packages/stage-ui exec vitest run --project node src/libs/auth-fetch.test.ts -t 'sends analytics identity headers with authenticated API requests'
```

The shared typecheck passed. The root typecheck passed all 54 tasks.
Lint finished with zero errors and 630 warnings.
The brand tests passed 10 cases. The Desktop tests passed 39 cases.
The UI command passed 21 cases and failed one case that used the upstream API URL.
That case now reads the configured server URL. Its targeted rerun passed.
All 71 distinct related cases passed across these runs. Previously passed cases were not rerun.

Additional checks passed for Capacitor configuration, generated native identifiers, Flatpak resources, workflow YAML, and Apple metadata syntax.
Packaging checks confirmed the customer update repository, required signing, and rejection of missing brand or notarization credentials.
The temporary customer values used for these checks were removed.

Signed native packages, installation, and real updates were not exercised.
The customer configuration and certificates remain absent. The active Apple developer directory contains Command Line Tools, not full Xcode.
