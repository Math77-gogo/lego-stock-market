/**
 * Imports BrickLink's official catalog download (bricklink.com → Catalog → Download,
 * Item Type "Sets", file type "Tab-Delimited File") so every set is searchable by name and theme.
 *
 * The official API has no keyword search, only exact-number lookups. Imported rows are NOT
 * tracked: they consume no API quota until someone opens or adds the set, at which point the
 * worker starts collecting its prices.
 *
 *   DATABASE_URL=... npm run catalog:import -- ./Sets.txt
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL)
  throw new Error("Usage: DATABASE_URL=... npm run catalog:import -- <Sets.txt>");

export function parseCatalog(text: string) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const header = lines[0]!.split("\t").map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iNo = col("number", "item no");
  const iName = col("name", "item name");
  const iCatId = col("category id");
  const iCat = col("category name");
  const iYear = col("year released", "year");
  if (iNo < 0 || iName < 0) throw new Error(`Unrecognized header: ${lines[0]}`);
  return lines
    .slice(1)
    .map((l) => {
      const c = l.split("\t");
      const year = Number(c[iYear] ?? "");
      return {
        no: c[iNo]!.trim(),
        name: c[iName]!.trim(),
        categoryId: iCatId >= 0 && c[iCatId] ? Number(c[iCatId]) : null,
        theme: iCat >= 0 ? c[iCat]?.trim() || null : null,
        year: Number.isInteger(year) && year > 1900 ? year : null,
      };
    })
    .filter((r) => r.no && r.name);
}

const rows = parseCatalog(await readFile(file, "utf8"));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let n = 0;
await db.query("begin");
for (const r of rows) {
  await db.query(
    `insert into public.lego_sets (bricklink_item_type, bricklink_item_number, name, category_id, theme, year_released,
       image_url, thumbnail_url, catalog_source, tracked)
     values ('SET', $1, $2, $3, $4, $5, $6, $7, 'bricklink_catalog_download', false)
     on conflict (bricklink_item_type, bricklink_item_number) do update set
       name = excluded.name, category_id = excluded.category_id, theme = coalesce(excluded.theme, lego_sets.theme),
       year_released = excluded.year_released`,
    [
      r.no,
      r.name,
      r.categoryId,
      r.theme,
      r.year,
      `https://img.bricklink.com/ItemImage/SN/0/${encodeURIComponent(r.no)}.png`,
      `https://img.bricklink.com/ItemImage/ST/0/${encodeURIComponent(r.no)}.t1.png`,
    ],
  );
  if (++n % 2000 === 0) console.log(`${n}/${rows.length}`);
}
await db.query("commit");
await db.end();
console.log(`Imported ${n} BrickLink catalog sets (untracked until opened or added).`);
