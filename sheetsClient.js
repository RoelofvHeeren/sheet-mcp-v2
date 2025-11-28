import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { fileURLToPath } from "url";
import { google } from "googleapis";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.resolve(__dirname, "token.json");
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const OOB_REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

const { GSHEETS_CLIENT_ID, GSHEETS_CLIENT_SECRET } = process.env;

function assertEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

async function loadTokensFromDisk() {
  try {
    const contents = await fs.readFile(TOKEN_PATH, "utf8");
    return JSON.parse(contents);
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function persistTokens(tokens) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

function needsRefresh(tokens) {
  if (!tokens?.expiry_date) {
    return true;
  }
  return tokens.expiry_date - Date.now() < TOKEN_REFRESH_BUFFER_MS;
}

async function promptForNewTokens(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    redirect_uri: OOB_REDIRECT_URI,
  });

  console.log("Authorize this app by visiting this URL:");
  console.log(authUrl);

  const rl = readline.createInterface({ input, output });
  const code = (await rl.question("Enter the authorization code from the browser: ")).trim();
  await rl.close();

  const { tokens } = await oauth2Client.getToken({
    code,
    redirect_uri: OOB_REDIRECT_URI,
  });

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token received from Google. Re-run the authorization and ensure consent is granted.",
    );
  }

  await persistTokens(tokens);
  return tokens;
}

async function ensureValidTokens(oauth2Client) {
  let tokens = await loadTokensFromDisk();
  if (!tokens) {
    tokens = await promptForNewTokens(oauth2Client);
  }

  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error(
      "token.json is missing a refresh_token. Delete the file and re-run authorization.",
    );
  }

  if (needsRefresh(tokens)) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    tokens = { ...tokens, ...credentials };
    oauth2Client.setCredentials(tokens);
    await persistTokens(tokens);
  }

  return tokens;
}

let sheetsClientPromise;

async function buildSheetsClient() {
  assertEnv(GSHEETS_CLIENT_ID, "GSHEETS_CLIENT_ID");
  assertEnv(GSHEETS_CLIENT_SECRET, "GSHEETS_CLIENT_SECRET");

  const oauth2Client = new google.auth.OAuth2(
    GSHEETS_CLIENT_ID,
    GSHEETS_CLIENT_SECRET,
    OOB_REDIRECT_URI,
  );

  oauth2Client.on("tokens", async (tokens) => {
    if (!tokens?.access_token && !tokens?.refresh_token) {
      return;
    }
    const merged = { ...oauth2Client.credentials, ...tokens };
    oauth2Client.setCredentials(merged);
    await persistTokens(merged);
  });

  await ensureValidTokens(oauth2Client);

  return google.sheets({ version: "v4", auth: oauth2Client });
}

export async function getSheetsClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = buildSheetsClient();
  }
  return sheetsClientPromise;
}
