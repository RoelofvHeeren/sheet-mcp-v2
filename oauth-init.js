import http from "http";
import fs from "fs/promises";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const { GSHEETS_CLIENT_ID, GSHEETS_CLIENT_SECRET } = process.env;

function assertEnv(value, name) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

assertEnv(GSHEETS_CLIENT_ID, "GSHEETS_CLIENT_ID");
assertEnv(GSHEETS_CLIENT_SECRET, "GSHEETS_CLIENT_SECRET");

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const PORT = 5173; // can be any available port
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http
      .createServer((req, res) => {
        if (!req.url.startsWith("/oauth2callback")) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://localhost:${PORT}`);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h3>You may close this window and return to the terminal.</h3></body></html>",
        );

        server.close();

        if (error) {
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!code) {
          reject(new Error("No code found in callback URL."));
          return;
        }
        resolve(code);
      })
      .listen(PORT, () => {
        console.log(`Listening on ${REDIRECT_URI} for OAuth callback...`);
      });
  });
}

async function main() {
  const oauth2Client = new google.auth.OAuth2(
    GSHEETS_CLIENT_ID,
    GSHEETS_CLIENT_SECRET,
    REDIRECT_URI,
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
  });

  console.log("Authorize this app by visiting this URL (opens in browser):\n");
  console.log(authUrl);
  console.log("\nWaiting for OAuth callback...");

  const code = await waitForCode();

  const { tokens } = await oauth2Client.getToken({
    code,
    redirect_uri: REDIRECT_URI,
  });
  oauth2Client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    console.error("No refresh_token received. Re-run with prompt=consent and offline access.");
    process.exit(1);
  }

  await fs.writeFile("tokens.json", JSON.stringify(tokens, null, 2));
  console.log("Tokens stored to tokens.json");
}

main().catch((err) => {
  console.error("Failed to complete OAuth flow:", err.message || err);
  process.exit(1);
});
