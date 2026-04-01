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
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

## Deploying with Wrangler (optional)

If you want to host the front-end on Cloudflare Pages/Workers as well:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

The `wrangler.jsonc` is already configured to serve the current directory as a static asset.
