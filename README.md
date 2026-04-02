# Expense Tracker

A personal mobile expense tracker (Spendly) that syncs to a Notion database via a Cloudflare Worker proxy.

---

## Setup

### Step 1 — Create a Notion Integration

1. Go to [notion.so](https://notion.so) and open your workspace.
2. Click your workspace name (top-left) → **Settings** → **Integrations** → **Develop or manage integrations**.
3. Click **New integration**, name it `Spendly`, select your workspace, and hit **Save**.
4. Copy the **Internal Integration Token** — it starts with `secret_` or `ntn_`. This is your **Notion API Key**.

---

### Step 2 — Create the Expenses Database

1. Create a new Notion page and type `/database` → choose **Table — Full page**.
2. Name the database `Expenses`.
3. Add the following columns with **exact names and types**:

| Column Name | Type            | Notes                  |
|-------------|-----------------|------------------------|
| `Name`      | Title           | Default column, keep as-is |
| `Amount`    | Number          | Stores the expense amount  |
| `Category`  | Select          | e.g. Food, Transport, etc. |
| `Date`      | Date            | Transaction date           |
| `Notes`     | Text (Rich text)| Optional notes, necessary if implementing PayLah!             |

4. Open the database page → click **•••** (top-right) → **Connections** → search for `Spendly` → **Connect**.

---

### Step 3 — Find Your Database ID

Open the database in your browser. The URL looks like:

```
https://www.notion.so/yourworkspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
```

The **32-character string** between the last `/` and the `?` is your **Database ID**.

---

### Step 4 — Deploy the Cloudflare Worker

The app cannot call the Notion API directly from a browser (CORS restriction), so a Cloudflare Worker acts as a proxy.

#### 4a — Create a Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Create Worker**.
2. Give it a name (e.g. `notion-proxy`) and click **Deploy**.
3. Click **Edit code** and replace the entire default script with the code below.
4. Click **Deploy**.

Your worker URL will be: `https://notion-proxy.<yourname>.workers.dev`

#### 4b — Worker Code

The full worker code is in [`notion-proxy-worker.js`](notion-proxy-worker.js). Copy the entire contents of that file into the Cloudflare editor and deploy.

---

### Step 5 — Configure the App

Open the app in your browser. On first launch you'll see a setup screen with these fields:

| Field               | Value                                              |
|---------------------|----------------------------------------------------|
| **Notion API Key**  | Your integration token (`secret_…` or `ntn_…`)    |
| **Notion Database ID** | 32-character ID from the database URL           |
| **Cloudflare Proxy URL** | `https://notion-proxy.<yourname>.workers.dev` |
| **Currency Symbol** | e.g. `$`, `£`, `€`, `S$`                         |
| **Your Name**       | Used for the greeting (optional)                  |

---

## Gmail Auto-Sync (Transaction Alerts)

Transactions are logged automatically by a Google Apps Script that monitors your Gmail bank alert emails. Every 12 hours it fetches any new alerts, parses the amount and merchant, and creates a Notion page directly — no manual input needed. The Spendly app picks them up on its next sync.

The script calls the Notion API directly (server-side, no CORS proxy needed) and applies a `spendly-processed` Gmail label to every thread it handles so it never double-processes.

### Step 6 — Set Up the Apps Script

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Delete the default `myFunction` code and paste the entire contents of [`gmail-to-notion.gs`](gmail-to-notion.gs).
3. In the editor, open the `setConfig` function, replace the placeholder values with your real credentials, then **run it once** (▶ button). Google will ask you to authorise Gmail and URL Fetch access — approve both.

```js
function setConfig() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    NOTION_KEY: 'secret_xxxx…',   // your Notion integration token
    NOTION_DB_ID: 'xxxxxxxx…',    // 32-char database ID
  });
}
```

4. Run `createTrigger()` once. This registers a time-based trigger that runs `processEmailAlerts` every 12 hours in the background — even when your phone is off. It also saves today's date as the cutoff, so historical emails are permanently ignored.

5. To test immediately, run `processEmailAlerts()` manually and check the **Execution log** (View → Executions).

### Supported Banks

| Bank | Sender | Subject filter |
|------|--------|----------------|
| DBS PayLah! | `paylah.alert@dbs.com` | `Transaction Alerts` |
| Citibank | `alerts@citibank.com.sg` | `Citi Alerts - Credit Card/Ready Credit Transaction` |


### Category Auto-Detection

The script writes the full display name into the Notion `Category` select field. If no rule matches, it defaults to `Miscellaneous`.

| Notion value      | Matched keywords (examples)                              |
|-------------------|----------------------------------------------------------|
| `Transport`       | Grab, taxi, MRT, SBS, EZ-Link                            |
| `Food & Drinks`   | restaurant, cafe, kopitiam, hawker, Starbucks, KFC       |
| `Shopping`        | NTUC, FairPrice, Cold Storage, Sheng Siong, Lazada       |
| `Health`          | clinic, pharmacy, Guardian, Watsons, hospital            |
| `Entertainment`   | cinema, Shaw, Golden Village, museum                     |
| `Subscriptions`   | Netflix, Spotify, Apple, Google Play                     |
| `Travel`          | airlines, Airbnb, hotel, ferry                           |
| `Investments`     | Syfe, Endowus, StashAway, Tiger Brokers, ETF, CPF invest |
| `Services`        | Singtel, StarHub, SP Group, insurance                    |
| `Family`          | school, tuition, childcare, kindergarten                 |
| `Miscellaneous`   | everything else (edit in Notion or the app afterwards)   |

### Pausing or Stopping

Run `removeTrigger()` in the Apps Script editor to stop the automatic sync.

---
