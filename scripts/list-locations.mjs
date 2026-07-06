import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));

import { gfetch } from '../src/google-auth.js';

const data = await gfetch(
  `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/116275598253754757177/locations?readMask=name,title,storefrontAddress&pageSize=100`
);
for (const loc of data.locations || []) {
  const id = loc.name.split('/')[1];
  const addr = loc.storefrontAddress;
  const city = addr ? (addr.locality || addr.administrativeArea || '') : '???';
  console.log(`${id}  |  ${loc.title}  |  ${city}`);
}
