# Retail inMotion Asset Manager

The Retail inMotion asset and device manager for Jira and Jira Service Management, installed on the Retail inMotion work site (`retailinmotion.atlassian.net`) and sandbox (`retailinmotion-sandbox1.atlassian.net`).

This is the internal edition. It is a separate repository and a separate Forge app from the Marketplace edition; nothing here is published to the Atlassian Marketplace.

## V1 release scope

The current V1 release candidate includes:

- Forge global page for the asset register, overview and reporting
- Manual create, edit and protected delete flows
- Mandatory, case-insensitive unique Device Name validation
- CSV and Excel `.xlsx` bulk import with preview and validation
- CSV export, search and filters
- Jira/JSM user search for optional holder identity
- Configurable asset types, statuses, locations and text/date custom fields
- Configurable Jira mappings for Device ID, related device, client, location, device type, device fault and assignment reference
- Resumable Jira Device ID discovery designed for production-sized sites
- Strong Device ID validation to reject placeholder or malformed values
- Assignment, Device Name, status and location history
- Asset detail, activity timeline and historical fault ledger
- Jira issue panel for linking a ticket to a device
- Jira `Device` custom field with a Device Name picker
- Device custom-field values retain the internal asset ID while displaying the friendly Device Name
- Per-device Jira support/fault history and latest-fault indicators
- Fleet-level reporting and CSV report export
- JSM portal organisation device view
- Safe, batched cleanup of Jira-discovered records
- Scale guards on KVS and Jira pagination paths so normal screens do not perform unlimited scans
- GitHub Actions validation, regression simulation, Forge lint, live Jira smoke tests and automatic development deployment

## Internal Asset Operations

Besides the asset register, this edition includes **Internal Asset Operations** (Jira admin page): Crew Tracking, Device Usage Reconciliation and SOTI Sync, plus the Portal+ snapshot publisher.

## Forge app and deployment

This repository has its own Forge app. Before the first deploy:

1. Run `forge register "Retail inMotion Asset Manager"` and replace the placeholder `app.id` in `manifest.yml` with the id it prints.
2. Add the repository secrets `FORGE_EMAIL`, `FORGE_API_TOKEN` (and `PLAYWRIGHT_STORAGE_STATE_B64` for browser QA), the GitHub environment `retailinmotion-sandbox1`, and the repository variable `ASSET_MANAGER_E2E_URL` (the Asset Manager page URL on the sandbox).

Merges to `main` deploy to the sandbox through the Forge `development` environment. The work site is deployed only by the manual **Deploy to Retail in Motion work site** workflow (see `docs/WORK_SITE_ROLLOUT.md`).

`npm run verify:branding` fails if the Marketplace brand appears anywhere in the repository; deploy workflows also fail while the Forge app id is still the placeholder.

## Limits

Resolvers are bounded so one call stays inside Forge execution time and per-installation rate limits on large sites. The caps customers can notice:

- **Per-prefix storage reads: 1,000 records.** The shared `queryAllByPrefix` helper reads at most 1,000 records for one key prefix in a single call. This bounds, for example, the activity history and fault history shown for one asset, and the number of distinct indexed clients offered as client options.
- **Client options: 10 storage pages.** `getJiraClientOptions` combines up to 1,000 indexed client values with client values read from at most 10 pages of the asset register (100 assets per page, so the first 1,000 assets). On larger registers a client that appears only on assets outside that window, and is not in the client index, is not offered in the Client filter or picker.
- **Device search: 2,000 assets.** Substring search in the Device field scans at most 20 pages (2,000 assets). An exact Device Name or Jira Device ID match is always found by key.

## Asset model

Core fields include internal asset ID, unique Device Name, authoritative Jira Device ID, client, type, manufacturer, model, serial number, optional Jira/JSM account identity, free-text holder/assignment reference, status, location, purchase date, warranty expiry, notes and configurable custom fields.

## Storage model

- `asset:<id>` — asset records
- `asset-name:<normalised-name>` — unique Device Name index
- `issue-link:<issueKey>` — issue-to-asset links
- `asset-history:<assetId>:<timestamp>:<id>` — asset activity history
- `fault-history:<assetId>:...` — historical fault records
- `settings:asset-manager` — admin configuration
- further prefixes are used for Crew Tracking and Device Usage Reconciliation

Assignment data is kept in Forge app storage rather than Jira entity properties.

## Import headings

The general asset importer recognises common headings including `Device Name`, `Name`, `Device ID`, `Type`, `Manufacturer`, `Model`, `Serial Number`, `Assigned To`, `Assigned Person / Holder`, `Crew Code`, `Status`, `Location`, `Purchase Date`, `Warranty Expiry` and `Notes`.

Device Name is required. Duplicate Device Names are rejected both within an import file and against the existing asset register.

## Release gate

Before rolling a change out to the work site:

1. Full CI validation and Forge lint pass on the commit.
2. The sandbox deploy and post-deploy Jira smoke tests pass.
3. Browser acceptance confirms Overview, Assets, Imports, Reports and Configuration render correctly.
4. Internal Crew Tracking, Device Usage Reconciliation and SOTI Sync pass their acceptance checks.

## Post-V1 roadmap

Items that should not delay V1 include optional SOTI MobiControl integration, deeper portal workflows, richer CMDB-style relationships and destructive/device-management actions.
