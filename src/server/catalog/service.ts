import type { Db } from "../db/context";
import type { CatalogItem, ItemType } from "../bricklink/types";

export interface LegoSet {
  id: string;
  itemType: ItemType;
  itemNumber: string;
  name: string;
  theme: string | null;
  categoryId: number | null;
  yearReleased: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  isObsolete: boolean | null;
  catalogFetchedAt: Date;
  tracked: boolean;
}

interface SetRow {
  id: string;
  bricklink_item_type: ItemType;
  bricklink_item_number: string;
  name: string;
  theme: string | null;
  category_id: number | null;
  year_released: number | null;
  image_url: string | null;
  thumbnail_url: string | null;
  is_obsolete: boolean | null;
  catalog_fetched_at: Date;
  tracked: boolean;
}

export const SET_COLS = `id, bricklink_item_type, bricklink_item_number, name, theme, category_id, year_released,
  image_url, thumbnail_url, is_obsolete, catalog_fetched_at, tracked`;

export function mapSet(r: SetRow): LegoSet {
  return {
    id: r.id,
    itemType: r.bricklink_item_type,
    itemNumber: r.bricklink_item_number,
    name: decodeEntities(r.name),
    theme: r.theme,
    categoryId: r.category_id,
    yearReleased: r.year_released,
    imageUrl: r.image_url,
    thumbnailUrl: r.thumbnail_url,
    isObsolete: r.is_obsolete,
    catalogFetchedAt: r.catalog_fetched_at,
    tracked: r.tracked,
  };
}

/** BrickLink catalog names contain HTML entities (e.g. "&#39;"). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** BrickLink image URLs are protocol-relative ("//img.bricklink.com/..."). */
export function normalizeImageUrl(url: string | undefined): string | null {
  if (!url) return null;
  const full = url.startsWith("//") ? `https:${url}` : url.replace(/^http:/, "https:");
  try {
    return new URL(full).hostname === "img.bricklink.com" ? full : null;
  } catch {
    return null;
  }
}

/** Normalizes user input like "75192" to BrickLink's set numbering ("75192-1"). */
export function normalizeSetNumber(input: string, type: ItemType = "SET"): string {
  const v = input.trim();
  if (type === "SET" && /^\d+$/.test(v)) return `${v}-1`;
  return v;
}

export async function upsertCatalogItem(
  db: Db,
  item: CatalogItem,
  theme: string | null,
  source: "bricklink_api_v1" | "bricklink_catalog_download" | "test_fixture" = "bricklink_api_v1",
): Promise<LegoSet> {
  const res = await db.query<SetRow>(
    `insert into public.lego_sets
       (bricklink_item_type, bricklink_item_number, name, category_id, theme, year_released, image_url,
        thumbnail_url, is_obsolete, catalog_source, catalog_fetched_at, tracked)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), true)
     on conflict (bricklink_item_type, bricklink_item_number) do update set
       name = excluded.name, category_id = excluded.category_id, theme = coalesce(excluded.theme, lego_sets.theme),
       year_released = excluded.year_released, image_url = coalesce(excluded.image_url, lego_sets.image_url),
       thumbnail_url = coalesce(excluded.thumbnail_url, lego_sets.thumbnail_url),
       is_obsolete = excluded.is_obsolete, catalog_source = excluded.catalog_source,
       catalog_fetched_at = now(), tracked = true
     returning ${SET_COLS}`,
    [
      item.type,
      item.no,
      item.name,
      item.category_id ?? null,
      theme,
      item.year_released ?? null,
      normalizeImageUrl(item.image_url),
      normalizeImageUrl(item.thumbnail_url),
      item.is_obsolete ?? null,
      source,
    ],
  );
  return mapSet(res.rows[0]!);
}

export async function findSet(db: Db, type: ItemType, no: string): Promise<LegoSet | null> {
  const res = await db.query<SetRow>(
    `select ${SET_COLS} from public.lego_sets where bricklink_item_type = $1 and bricklink_item_number = $2`,
    [type, no],
  );
  return res.rows[0] ? mapSet(res.rows[0]) : null;
}

export async function getSetById(db: Db, id: string): Promise<LegoSet | null> {
  const res = await db.query<SetRow>(`select ${SET_COLS} from public.lego_sets where id = $1`, [
    id,
  ]);
  return res.rows[0] ? mapSet(res.rows[0]) : null;
}

/** Searches the catalog rows stored from BrickLink (number, name, theme). */
export async function searchCatalog(
  db: Db,
  query: string,
  opts: { theme?: string | null; limit?: number } = {},
): Promise<LegoSet[]> {
  const q = query.trim();
  const res = await db.query<SetRow>(
    `select ${SET_COLS} from public.lego_sets
      where ($1 = '' or bricklink_item_number ilike $1 || '%' or name ilike '%' || $1 || '%' or theme ilike '%' || $1 || '%')
        and ($2::text is null or theme = $2)
      order by (bricklink_item_number = $1 or bricklink_item_number = $1 || '-1') desc,
               (bricklink_item_number ilike $1 || '%') desc,
               similarity(name, $1) desc, name asc
      limit $3`,
    [q, opts.theme ?? null, opts.limit ?? 40],
  );
  return res.rows.map(mapSet);
}

export async function listThemes(db: Db): Promise<string[]> {
  const res = await db.query<{ theme: string }>(
    `select distinct theme from public.lego_sets where theme is not null order by theme`,
  );
  return res.rows.map((r) => r.theme);
}

export async function categoryName(db: Db, categoryId: number | undefined): Promise<string | null> {
  if (categoryId === undefined) return null;
  const res = await db.query<{ category_name: string }>(
    "select category_name from public.bricklink_categories where category_id = $1",
    [categoryId],
  );
  return res.rows[0]?.category_name ?? null;
}
