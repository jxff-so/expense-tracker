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

      let results = [];
      let hasMore = true;
      let startCursor;

      while (hasMore) {
        const payload = { page_size: 100 };
        if (startCursor) payload.start_cursor = startCursor;

        const pageRes = await fetch(`${NOTION_API}/databases/${dbId}/query`, {
          method: "POST",
          headers: notionHeaders,
          body: JSON.stringify(payload),
        });

        if (!pageRes.ok) {
          const errorText = await pageRes.text();
          return new Response(errorText, {
            status: pageRes.status,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const pageData = await pageRes.json();
        results = results.concat(pageData.results || []);
        hasMore = pageData.has_more;
        startCursor = pageData.next_cursor;
      }

      notionRes = new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
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
