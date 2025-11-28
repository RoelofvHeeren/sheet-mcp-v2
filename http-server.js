import http from "http";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { getSheetsClient } from "./sheetsClient.js";

dotenv.config();

const { GSHEETS_CLIENT_ID, GSHEETS_CLIENT_SECRET, DEFAULT_SHEET_ID, DEFAULT_RANGE } =
  process.env;
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

function resolveTarget(input) {
  const spreadsheetId = input?.spreadsheetId || DEFAULT_SHEET_ID;
  const range = input?.range || DEFAULT_RANGE;

  if (!spreadsheetId || !range) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Missing spreadsheetId and range, and no fallback defined in .env",
    );
  }

  console.log(`[Sheets] Using spreadsheetId=${spreadsheetId}, range=${range}`);
  return { spreadsheetId, range };
}

async function appendRows(input) {
  const { spreadsheetId, range, rows } = input;
  const target = resolveTarget({ spreadsheetId, range });
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: target.spreadsheetId,
    range: target.range,
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

async function readRows(input) {
  const { spreadsheetId, range } = input;
  const target = resolveTarget({ spreadsheetId, range });
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: target.spreadsheetId,
    range: target.range,
  });

  return { rows: res.data.values ?? [] };
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
      required: ["rows"],
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

mcpServer.tool(
  "read_rows",
  {
    description: "Reads rows from a specific sheet and range in a Google Spreadsheet.",
    inputSchema: {
      type: "object",
      required: [],
      properties: {
        spreadsheetId: { type: "string" },
        range: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  async (input) => {
    try {
      return await readRows(input);
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
