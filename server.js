import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { getSheetsClient } from "./sheetsClient.js";

dotenv.config();

async function appendRows({ spreadsheetId, range, rows }) {
  const sheets = await getSheetsClient();

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

async function readRows({ spreadsheetId, range }) {
  const sheets = await getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return { rows: res.data.values ?? [] };
}

const server = new McpServer(
  { name: "google-sheets-mcp", version: "1.0.0" },
  { capabilities: {} },
);

server.tool(
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

server.tool(
  "read_rows",
  {
    description: "Reads rows from a specific sheet and range in a Google Spreadsheet.",
    inputSchema: {
      type: "object",
      required: ["spreadsheetId", "range"],
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

const transport = new StdioServerTransport();
server.connect(transport);
