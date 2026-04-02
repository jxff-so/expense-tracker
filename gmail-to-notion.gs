/**
 * Spendly — Gmail → Notion Auto-Sync
 *
 * Watches for PayLah! + Citibank transaction alert emails and automatically
 * logs them to your Notion Expenses database.
 *
 * SETUP:
 *  0. Change the respective bank alerts threshold to receive email alerts
 *  1. Open script.google.com → New project → paste this file.
 *  2. Run setConfig() once to store your credentials.
 *  3. Run createTrigger() once to start the 12 hour auto-sync.
 *  4. Authorise the permissions Google requests (Gmail + URL Fetch).
 */

// ─────────────────────────────────────────────
// CONFIGURATION — run setConfig() once to save
// ─────────────────────────────────────────────

function setConfig() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    NOTION_KEY: 'secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxx', // your Notion integration token
    NOTION_DB_ID: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',  // 32-char database ID
  });
  console.log('Config saved.');
}

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    notionKey: props.getProperty('NOTION_KEY'),
    dbId:      props.getProperty('NOTION_DB_ID'),
  };
}

// ─────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────

const CATEGORY_RULES = [
  { name: 'Transport',     pattern: /grab|gojek|taxi|comfort\s*del?gro|citycab|transit|mrt|smrt|sbs|lta|ez.?link|bus\s*inter/i },
  { name: 'Food & Drinks', pattern: /food|restaurant|cafe|coffee|starbucks|mcdonald|kfc|burger|pizza|sushi|noodle|rice|chicken|fish|bakery|kopitiam|hawker|toast|dim\s*sum|bbq|grill|kitchen|eatery|dine|bistro|canteen|foodcourt/i },
  { name: 'Shopping',      pattern: /shopping|retail|fashion|uniqlo|zara|h&m|h and m|ikea|courts|harvey\s*norman|best\s*denki|lazada|shopee|taobao|amazon|giant|ntuc|fairprice|cold\s*storage|sheng\s*siong|minimart|supermart|market/i },
  { name: 'Health',        pattern: /clinic|pharmacy|guardian|watsons|hospital|dental|medical|health|polyclinic|raffles\s*medical|shenton/i },
  { name: 'Entertainment', pattern: /cinema|shaw|cathay|golden\s*village|gv\b|movie|entertainment|amusement|attraction|zoo|museum|art|theatre/i },
  { name: 'Subscriptions', pattern: /netflix|spotify|apple|google\s*play|disney|youtube|hulu|steam|adobe|dropbox|icloud/i },
  { name: 'Travel',        pattern: /airlines|airasia|scoot|singapore\s*airlines|sia\b|jetstar|hotel|hostel|airbnb|booking\.com|agoda|ferry|cruise/i },
  { name: 'Investments',   pattern: /brokerage|syfe|endowus|stashaway|tiger\s*brokers|moomoo|saxo|phillip|poems|cdp|cpf\s*invest|robo|etf|stocks?|shares?|fund/i },
  { name: 'Services',      pattern: /singtel|starhub|m1\b|circles|myrepublic|telco|broadband|electricity|sp\s*group|town\s*council|insurance|ntuc\s*income|aia\b|prudential|great\s*eastern/i },
  { name: 'Family',        pattern: /school|tuition|childcare|kindergarten|education|learning/i },
];

function guessCategory(merchant) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(merchant)) return rule.name;
  }
  return 'Miscellaneous';
}

// ─────────────────────────────────────────────
// EMAIL PARSER
// ─────────────────────────────────────────────

/**
 * Parses a PayLah! alert email body and returns a transaction object,
 * or null if the email doesn't match the expected format.
 *
 * Expected format (key parts):
 *   Date & Time:28 Mar 20:17 (SGT)Amount:SGD5.00From:PayLah! Wallet (...)To:MERCHANT NAME
 */
function parsePayLahEmail(body, emailDate) {
  // Amount — "Amount:SGD5.00" or "Amount: SGD 5.00"
  const amountMatch = body.match(/Amount:\s*SGD\s*(\d+(?:\.\d{1,2})?)/i);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1]);
  if (!amount || amount <= 0) return null;

  // Merchant — "To:MERCHANT NAME\n" (the second "To" in the email)
  // The body has both "To:MERCHANT" and "To view your transactions" —
  // we rely on MERCHANT being ALL-CAPS DBS format and appearing before "To view".
  const merchantMatch = body.match(/\bTo:\s*(.+?)(?=\s*(?:\r?\n|To view))/);
  const rawMerchant = merchantMatch ? merchantMatch[1].trim() : 'PayLah! Payment';
  const merchant = cleanMerchantName(rawMerchant);

  // Date — "Date & Time:28 Mar 20:17 (SGT)"
  const dateMatch = body.match(/Date\s*&\s*Time:\s*(\d{1,2}\s+\w{3})\s+(\d{2}:\d{2})/i);
  let txnDate;
  if (dateMatch) {
    const year = emailDate.getFullYear();
    // Parse "28 Mar" and combine with email's year and the extracted time
    const parsed = new Date(`${dateMatch[1]} ${year} ${dateMatch[2]} GMT+0800`);
    // Guard against year rollover (e.g. Dec email processed in Jan)
    txnDate = parsed > new Date() ? new Date(`${dateMatch[1]} ${year - 1} ${dateMatch[2]} GMT+0800`) : parsed;
  } else {
    txnDate = emailDate;
  }

  return {
    amount,
    merchant,
    category: guessCategory(rawMerchant),
    date: txnDate.toISOString(),
    notes: '',
  };
}

function cleanMerchantName(name) {
  return name
    .replace(/\s*\b(PTE\.?\s*LTD\.?|SDN\.?\s*BHD\.?|LLP\.?|LLC\.?|INC\.?|CORP\.?|CO\.?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────
// NOTION API
// ─────────────────────────────────────────────

function createNotionPage(txn, config) {
  // Ensure DB ID is hyphenated (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const dbId = config.dbId.replace(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/i,
    '$1-$2-$3-$4-$5');

  const payload = {
    parent: { database_id: dbId },
    properties: {
      Name:     { title:  [{ text: { content: txn.merchant } }] },
      Amount:   { number: txn.amount },
      Category: { select: { name: txn.category } },
      Date:     { date:   { start: txn.date } },
      ...(txn.notes && { Notes: { rich_text: [{ text: { content: txn.notes } }] } }),
    },
  };

  const res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    headers: {
      'Authorization':  `Bearer ${config.notionKey}`,
      'Content-Type':   'application/json',
      'Notion-Version': '2022-06-28',
    },
    payload:           JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    return true;
  }
  console.error(`Notion API ${code}:`, res.getContentText());
  return false;
}

// ─────────────────────────────────────────────
// CITI PARSER
// ─────────────────────────────────────────────

/**
 * Parses a Citibank credit card alert email body.
 *
 * Expected format (key parts):
 *   Transaction date: 20/03/20
 *   Transaction time: 12:00:00
 *   Transaction amount: 500
 *   Transaction details : SHOPEE SINGAPORE MP SINGAPORE SGP
 */
function parseCitiEmail(body, emailDate) {
  // Amount — "Transaction amount: 500" or "Transaction amount: 12.50"
  const amountMatch = body.match(/Transaction\s+amount\s*:\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!amountMatch) return null;
  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (!amount || amount <= 0) return null;

  // Merchant — "Transaction details : SHOPEE SINGAPORE MP SINGAPORE SGP"
  const merchantMatch = body.match(/Transaction\s+details\s*:\s*(.+)/i);
  const rawMerchant = merchantMatch ? merchantMatch[1].trim() : 'Citi Card Payment';
  const merchant = cleanMerchantName(rawMerchant);

  // Date — "Transaction date: 20/03/20" + "Transaction time: 12:00:00"
  const dateMatch = body.match(/Transaction\s+date\s*:\s*(\d{2}\/\d{2}\/\d{2,4})/i);
  const timeMatch = body.match(/Transaction\s+time\s*:\s*(\d{2}:\d{2}:\d{2})/i);
  let txnDate;
  if (dateMatch) {
    const parts = dateMatch[1].split('/'); // DD/MM/YY or DD/MM/YYYY
    const day   = parts[0];
    const month = parts[1];
    const year  = parts[2].length === 2 ? '20' + parts[2] : parts[2];
    const time  = timeMatch ? timeMatch[1] : '00:00:00';
    txnDate = new Date(`${year}-${month}-${day}T${time}+08:00`);
  } else {
    txnDate = emailDate;
  }

  return {
    amount,
    merchant,
    category: guessCategory(rawMerchant),
    date: txnDate.toISOString(),
    notes: '',
  };
}

// ─────────────────────────────────────────────
// MAIN — called by the time trigger
// ─────────────────────────────────────────────

function processEmailAlerts() {
  const config = getConfig();
  if (!config.notionKey || !config.dbId) {
    console.error('Missing config — run setConfig() first.');
    return;
  }

  // Create the "spendly-processed" Gmail label on first run
  let label = GmailApp.getUserLabelByName('spendly-processed');
  if (!label) label = GmailApp.createLabel('spendly-processed');

  const startDate = PropertiesService.getScriptProperties().getProperty('START_DATE')
    || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');

  const SOURCES = [
    { query: `from:paylah.alert@dbs.com subject:"Transaction Alerts" -label:spendly-processed after:${startDate}`,  parser: parsePayLahEmail },
    { query: `from:alerts@citibank.com.sg subject:"Citi Alerts - Credit Card/Ready Credit Transaction" -label:spendly-processed after:${startDate}`, parser: parseCitiEmail   },
  ];

  let processed = 0;
  let failed    = 0;
  let total     = 0;

  for (const source of SOURCES) {
    const threads = GmailApp.search(source.query, 0, 20);
    total += threads.length;

    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const body = message.getPlainBody();
        const txn  = source.parser(body, message.getDate());

        if (!txn) {
          console.warn('Could not parse email:', message.getSubject());
          continue;
        }

        const ok = createNotionPage(txn, config);
        ok ? processed++ : failed++;

        console.log(`${ok ? '✓' : '✗'} ${txn.merchant} — SGD ${txn.amount.toFixed(2)} [${txn.category}]`);
      }

      thread.addLabel(label);
    }
  }

  console.log(`Done — ${processed} synced, ${failed} failed, ${total} threads processed.`);
}

// ─────────────────────────────────────────────
// TRIGGER SETUP — run once manually
// ─────────────────────────────────────────────

/**
 * Creates a time-based trigger that runs processEmailAlerts every 12 hours.
 * Also records today as the cutoff — emails before this date are always ignored.
 * Run this function once from the Apps Script editor.
 *
 * Note: Apps Script only supports 1, 2, 4, 6, 8, or 12 for everyHours() —
 * 10 is not a valid interval, so 12 (twice a day) is the closest option.
 */
function createTrigger() {
  // Record today as the start date — emails before this will always be skipped
  const startDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
  PropertiesService.getScriptProperties().setProperty('START_DATE', startDate);

  // Remove any existing triggers for this function to avoid duplicates
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processEmailAlerts')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processEmailAlerts')
    .timeBased()
    .everyHours(12)
    .create();

  console.log(`Trigger created — processEmailAlerts runs every 12 hours, starting from ${startDate}.`);
}

/** Removes all triggers (use if you want to pause the sync). */
function removeTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processEmailAlerts')
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log('Trigger removed.');
}
