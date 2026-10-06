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

The work site and sandbox previously ran Asset Manager under the Marketplace app's Forge app id.
This repository is a new Forge app, so its storage starts empty and the old app's data does not
carry over. For each site:

1. In the old app, export the asset register (Assets → Export CSV) and note the Configuration.
2. Deploy and install this app (sandbox through CI, work site through the manual workflow).
3. Configure it as above, run the Jira scan, then import the exported CSV.
4. Uninstall the old app from the site (`forge uninstall` from the Marketplace repository, or
   Manage apps), so only the Retail inMotion app remains. Its Device custom field goes with it;
   this app adds its own Device field, filled again by the Jira scan.
