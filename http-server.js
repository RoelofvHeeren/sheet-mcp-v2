import http from "http";
import fs from "fs/promises";
import dotenv from "dotenv";
import { google } from "googleapis";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const { GSHEETS_CLIENT_ID, GSHEETS_CLIENT_SECRET } = process.env;
const TOKEN_PATH = "tokens.json";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ENDPOINT = "/mcp";

function assertEnv(value, name) {
  if (!value) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Missing required environment variable: ${name}`,
    );
  }
}

assertEnv(GSHEETS_CLIENT_ID, "GSHEETS_CLIENT_ID");
assertEnv(GSHEETS_CLIENT_SECRET, "GSHEETS_CLIENT_SECRET");

async function loadTokens() {
  const contents = await fs.readFile(TOKEN_PATH, "utf8");
  return JSON.parse(contents);
}

async function saveTokens(tokens) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function needsRefresh(tokens) {
  if (!tokens.expiry_date) {
    return true;
  }
  return tokens.expiry_date - Date.now() < TOKEN_REFRESH_BUFFER_MS;
}

const oauth2Client = new google.auth.OAuth2(
  GSHEETS_CLIENT_ID,
  GSHEETS_CLIENT_SECRET,
  "http://localhost",
);

let cachedTokens;

async function ensureAuth() {
  if (!cachedTokens) {
    try {
      cachedTokens = await loadTokens();
    } catch (err) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "tokens.json not found. Run npm run auth to generate tokens.",
      );
    }
    oauth2Client.setCredentials(cachedTokens);
  }

  if (needsRefresh(cachedTokens)) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    cachedTokens = { ...cachedTokens, ...credentials };
    oauth2Client.setCredentials(cachedTokens);
    await saveTokens(cachedTokens);
  }

  if (!cachedTokens.refresh_token) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "tokens.json is missing a refresh_token. Re-run npm run auth.",
    );
  }

  return oauth2Client;
}

async function appendRows({ spreadsheetId, range, rows }) {
  const auth = await ensureAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: rows,
    },
  });

  const data = res.data;
  return {
    updatedRows: data.updates?.updatedRows ?? 0,
    updatedRange: data.updates?.updatedRange ?? "",
  };
}

const mcpServer = new McpServer(
  { name: "google-sheets-mcp", version: "1.0.0" },
  { capabilities: {} },
);

mcpServer.tool(
  "append_rows",
  {
    description: "Append rows to a Google Sheet",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId", "range", "rows"],
      properties: {
        spreadsheetId: { type: "string" },
        range: { type: "string" },
        rows: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      additionalProperties: false,
    },
  },
  async (input) => {
    try {
      return await appendRows(input);
    } catch (err) {
      if (err instanceof McpError) {
        throw err;
      }

      const message = err?.message || "Unknown error";
      throw new McpError(ErrorCode.InternalError, message);
    }
  },
);

const transport = new StreamableHTTPServerTransport({
  // Stateless mode: no session ID required in headers. Easier for clients that
  // don't manage session IDs yet.
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
});

const httpServer = http.createServer(async (req, res) => {
  if (!req.url?.startsWith(ENDPOINT)) {
    res.writeHead(404).end("Not Found");
    return;
  }
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("Transport error", err);
    res.writeHead(500).end("Internal Server Error");
  }
});

async function start() {
  await mcpServer.connect(transport);
  httpServer.listen(PORT, () => {
    console.log(`MCP HTTP server listening on http://localhost:${PORT}${ENDPOINT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
