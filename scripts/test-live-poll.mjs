import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));

import { listReviews } from '../src/gbp.js';
import { ACTIVE_STORES } from '../src/config.js';

// Test a few mapped stores
const testStores = ACTIVE_STORES.filter(s => s.gbpLocationId).slice(0, 4);
console.log(`Testing ${testStores.length} stores...\n`);

for (const store of testStores) {
  console.log(`=== ${store.name} (${store.gbpLocationId}) ===`);
  try {
    const reviews = await listReviews(store, { pageSize: 3 });
    for (const r of reviews) {
      const replied = r.hasReply ? '✅replied' : '⬜ open';
      console.log(`  ${r.rating}★ ${replied}  ${r.reviewerName}  "${(r.comment||'').slice(0,60)}"`);
    }
    if (reviews.length === 0) console.log('  (no recent reviews)');
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  console.log();
}
