import { getSheetsClient } from "./sheetsClient.js";

async function main() {
  await getSheetsClient();
  console.log("Authorization complete. Credentials saved to token.json.");
}

main().catch((err) => {
  console.error("Failed to complete OAuth flow:", err.message || err);
  process.exit(1);
});
