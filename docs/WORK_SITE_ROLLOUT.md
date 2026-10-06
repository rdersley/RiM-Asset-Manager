# Rolling out to retailinmotion.atlassian.net

The work site runs the internal edition from its own Forge environment, `work-site`.
Merges to `main` keep going to the sandbox only; the work site changes only when the
**Deploy to Retail in Motion work site** workflow is run (Actions → that workflow → Run,
type `DEPLOY`).

A fresh install does nothing to tickets until it is configured: the Jira scan, the
Device ID check, the Device type fill and status automation all need fields mapped first,
and status automation is off until switched on. Configure in this order:

1. **Asset types**: vPOS, PED, Printer, vPack, … spelled as in the Device Type field.
2. **Device ID format**: one line per format, for example `vPOS: RYRS######`.
3. **Field mapping**: Device ID field, Device type field, client, location and holder fields,
   and the project key. Leave "Automatically scan and import" off for now.
4. **Preview Jira scan**: check the devices it would add and the values it would skip.
   Tighten the formats and preview again until the new devices look right.
5. **Device ID clean-up** (Data conflicts): fix, clear or ignore the skipped values.
6. **Run the Jira scan**, then switch automatic scanning on.
7. **Import** any spreadsheet register; matches merge into the scanned devices.
8. **SOTI Sync**: enter the API client, Test connection, Sync now.
9. Last, once the register is right: **status rules** and the **replacement rule**.

Sandbox data does not move across; export from the sandbox and import if you need it.

## Moving from the previous Asset Manager app

The work site and sandbox previously ran Asset Manager under another Forge app. This repository is
a new Forge app with its own storage, so data is moved with **Backup & restore** (Configuration,
Jira admins only). Nothing is lost as long as the previous app is uninstalled only at the end.
For each site:

1. In the previous app: Configuration → **Download backup**. This saves every setting and record
   (assets, history, issue links, crew register, SOTI settings, …) in one file. The SOTI password
   is never included.
2. Deploy and install this app (sandbox through CI, work site through the manual workflow). Both
   apps can be installed side by side.
3. In this app: Configuration → **Restore** → choose the file → **Restore this backup**.
4. Still in Backup & restore: **Copy Device field values**, choosing the previous app's Device
   field. Each ticket's Device is copied into this app's Device field. It is safe to run again.
5. Re-enter the SOTI password (SOTI Sync), reload, and check Overview, Reports and a few tickets.
6. Only then uninstall the previous app from the site (Manage apps), so only this app remains.
