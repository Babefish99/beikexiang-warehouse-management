export const CANONICAL_ITEM_CATEGORIES = [
  { id: "category-bj", code: "CATEGORY_BJ", prefix: "BJ", name: "白酒" },
  { id: "category-hj", code: "CATEGORY_HJ", prefix: "HJ", name: "红酒" },
  { id: "category-cy", code: "CATEGORY_CY", prefix: "CY", name: "茶饮" },
  { id: "category-wp", code: "CATEGORY_WP", prefix: "WP", name: "其他物品" },
] as const;

export type CanonicalItemCategory = (typeof CANONICAL_ITEM_CATEGORIES)[number];
