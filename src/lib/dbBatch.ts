/**
 * Bulk-write helpers shared by anything that touches the database at scale -
 * the Google Sheets sync and the backup/restore tool both use these. A single
 * statement carrying thousands of rows, or a single query with thousands of
 * values in an IN clause, is slow enough on its own to risk Vercel's 60-second
 * function timeout; these split the work into chunks instead.
 */

/** Split a bulk insert/update so no single statement carries the whole set. */
export async function createManyChunked<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
  size = 1000
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}

/**
 * Read back a large set of rows by key (e.g. "give me the ids for these 15,000
 * phone numbers") without sending one query with a 15,000-item IN clause.
 * Splits into chunks and runs a few chunks at a time in parallel.
 */
export async function findManyChunked<K, T>(
  keys: K[],
  query: (chunk: K[]) => Promise<T[]>,
  size = 1000,
  concurrency = 5
): Promise<T[]> {
  const chunks: K[][] = [];
  for (let i = 0; i < keys.length; i += size) chunks.push(keys.slice(i, i + size));

  const results: T[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((c) => query(c)));
    for (const r of batchResults) results.push(...r);
  }
  return results;
}
