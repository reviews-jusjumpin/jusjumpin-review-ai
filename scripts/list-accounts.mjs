import { listAccounts } from '../src/gbp.js';
const data = await listAccounts();
console.log(JSON.stringify(data, null, 2));
