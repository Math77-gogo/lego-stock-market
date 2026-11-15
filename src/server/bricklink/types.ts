import { z } from "zod";

export const ITEM_TYPES = [
  "SET",
  "MINIFIG",
  "PART",
  "BOOK",
  "GEAR",
  "CATALOG",
  "INSTRUCTION",
  "UNSORTED_LOT",
  "ORIGINAL_BOX",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export type Condition = "N" | "U";
export type GuideType = "sold" | "stock";

/** BrickLink returns decimal values as strings ("123.4567"). */
const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(v)))
  .refine((v) => Number.isFinite(v), "not a number");

export const metaSchema = z.object({
  code: z.number(),
  message: z.string().optional().default(""),
  description: z.string().optional().default(""),
});

export const catalogItemSchema = z.object({
  no: z.string(),
  name: z.string(),
  type: z.string(),
  category_id: z.number().optional(),
  image_url: z.string().optional(),
  thumbnail_url: z.string().optional(),
  year_released: z.number().optional(),
  is_obsolete: z.boolean().optional(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const priceDetailSchema = z
  .object({
    quantity: z.number().optional(),
    qunatity: z.number().optional(), // BrickLink's documented misspelling on some responses
    unit_price: decimal.optional(),
    date_ordered: z.string().optional(),
    seller_country_code: z.string().optional(),
    buyer_country_code: z.string().optional(),
  })
  .passthrough();

export const priceGuideSchema = z.object({
  item: z.object({ no: z.string(), type: z.string() }),
  new_or_used: z.enum(["N", "U"]),
  currency_code: z.string().length(3),
  min_price: decimal.optional(),
  max_price: decimal.optional(),
  avg_price: decimal.optional(),
  qty_avg_price: decimal.optional(),
  unit_quantity: z.number().int().nonnegative().optional(),
  total_quantity: z.number().int().nonnegative().optional(),
  price_detail: z.array(priceDetailSchema).optional().default([]),
});
export type PriceGuide = z.infer<typeof priceGuideSchema>;

export const categorySchema = z.object({
  category_id: z.number(),
  category_name: z.string(),
  parent_id: z.number().optional(),
});
export type Category = z.infer<typeof categorySchema>;
