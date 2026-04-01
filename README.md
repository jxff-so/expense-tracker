# expense-tracker

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
| `Notes`     | Text (Rich text)| Optional notes             |

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

```js
const NOTION_API = "https://api.notion.com/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Notion-Version, X-Database-Id, X-Page-Id",
};

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const auth = request.headers.get("Authorization");
    const notionVersion = request.headers.get("Notion-Version") || "2022-06-28";

    const notionHeaders = {
      "Authorization": auth,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    };

    let notionRes;

    if (request.method === "GET") {
      // Query the database — Database ID passed via X-Database-Id header
      const dbId = request.headers.get("X-Database-Id");
      if (!dbId) {
        return new Response(JSON.stringify({ message: "Missing X-Database-Id header" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      notionRes = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify({ page_size: 100 }),
      });

    } else if (request.method === "POST") {
      // Create a new page (add transaction)
      const body = await request.json();
      notionRes = await fetch(`${NOTION_API}/pages`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify(body),
      });

    } else if (request.method === "PATCH") {
      // Update page properties (edit transaction) — Page ID passed via X-Page-Id header
      const pageId = request.headers.get("X-Page-Id");
      if (!pageId) {
        return new Response(JSON.stringify({ message: "Missing X-Page-Id header" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      const body = await request.json();
      notionRes = await fetch(`${NOTION_API}/pages/${pageId}`, {
        method: "PATCH",
        headers: notionHeaders,
        body: JSON.stringify(body),
      });

    } else if (request.method === "DELETE") {
      // Archive a page (delete transaction) — Page ID passed via X-Page-Id header
      const pageId = request.headers.get("X-Page-Id");
      if (!pageId) {
        return new Response(JSON.stringify({ message: "Missing X-Page-Id header" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      notionRes = await fetch(`${NOTION_API}/pages/${pageId}`, {
        method: "PATCH",
        headers: notionHeaders,
        body: JSON.stringify({ archived: true }),
      });

    } else {
      return new Response(JSON.stringify({ message: "Method not allowed" }), {
        status: 405, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const data = await notionRes.text();
    return new Response(data, {
      status: notionRes.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  },
};
```

---

### Step 5 — Configure the App

Open the app in your browser (or deploy it with `wrangler deploy`). On first launch you'll see a setup screen with these fields:

| Field               | Value                                              |
|---------------------|----------------------------------------------------|
| **Notion API Key**  | Your integration token (`secret_…` or `ntn_…`)    |
| **Notion Database ID** | 32-character ID from the database URL           |
| **Cloudflare Proxy URL** | `https://notion-proxy.<yourname>.workers.dev` |
| **Currency Symbol** | e.g. `$`, `£`, `€`, `S$`                         |
| **Your Name**       | Used for the greeting (optional)                  |

---

## Gmail Auto-Sync (PayLah! Alerts)

Transactions are logged automatically by a Google Apps Script that monitors your Gmail for PayLah! alert emails from `paylah.alert@dbs.com`. Every 12 hours it fetches any new alerts, parses the amount and merchant, and creates a Notion page directly — no manual input needed. The Spendly app picks them up on its next sync.

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

4. Run `createTrigger()` once. This registers a time-based trigger that runs `processPayLahEmails` every 12 hours in the background — even when your phone is off. It also saves today's date as the cutoff, so historical emails are permanently ignored.

5. To test immediately, run `processPayLahEmails()` manually and check the **Execution log** (View → Executions).

### How It Parses the Email

Given an email body like:

```
Transaction Ref: IPS00000000XXXXXXX
Date & Time:20 Mar 20:00 (SGT)
Amount:SGD5.00
From:PayLah! Wallet (Mobile ending 9999)
To:FOOD HOLDINGS PTE.LTD.
```

The script extracts:

| Field    | Extracted value                           |
|----------|-------------------------------------------|
| Name     | `FOOD HOLDINGS` (legal suffix stripped)   |
| Amount   | `5.00`                                    |
| Category | `Food & Drinks` (auto-detected)           |
| Date     | `2025-03-20T20:00:00+08:00`               |
| Notes    | `Ref: IPS00000000XXXXXXX`                 |

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

## Deploying with Wrangler (optional)

If you want to host the front-end on Cloudflare Pages/Workers as well:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

The `wrangler.jsonc` is already configured to serve the current directory as a static asset.
