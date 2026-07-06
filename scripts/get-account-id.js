import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch {}

import { gfetch } from "../src/google-auth.js";

const accounts = await gfetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
console.log(JSON.stringify(accounts, null, 2));
