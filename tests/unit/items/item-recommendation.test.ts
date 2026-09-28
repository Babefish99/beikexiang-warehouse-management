import { describe, expect, it } from "vitest";

import { recommendStandardItems } from "../../../apps/api/src/domain/items/item-recommendation.js";

describe("local standard-item recommendation", () => {
  it("prefills a unique exact alias match with an explainable high-confidence result", () => {
    const result = recommendStandardItems({
      requestedDescription: "白酒",
      requestedUnit: "瓶",
      items: [
        { id: "item-wine", code: "BJ0023", name: "陈厚酒6年", specification: "500ml", unit: "瓶", aliases: ["白酒", "接待酒"] },
        { id: "item-tea", code: "CY0001", name: "红茶", specification: "礼盒", unit: "盒", aliases: [] },
      ],
      learnings: [],
    });

    expect(result.recommendedItemId).toBe("item-wine");
    expect(result.candidates[0]).toMatchObject({
      itemId: "item-wine",
      confidence: "HIGH",
      reasons: ["别名“白酒”完全匹配"],
    });
  });

  it("keeps weak same-unit candidates visible without preselecting one", () => {
    const result = recommendStandardItems({
      requestedDescription: "宴请用品",
      requestedUnit: "瓶",
      items: [
        { id: "item-wine-a", code: "BJ0001", name: "陈厚酒6年", specification: "500ml", unit: "瓶", aliases: [] },
        { id: "item-wine-b", code: "BJ0002", name: "赤霞珠干红", specification: "750ml", unit: "瓶", aliases: [] },
      ],
      learnings: [],
    });

    expect(result.recommendedItemId).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.confidence === "LOW")).toBe(true);
    expect(result.candidates.every((candidate) => candidate.reasons.includes("单位一致，需人工确认"))).toBe(true);
  });

  it("turns a repeated administrator confirmation into a high-confidence prefill", () => {
    const result = recommendStandardItems({
      requestedDescription: "老板接待用酒",
      requestedUnit: "瓶",
      items: [
        { id: "item-wine-a", code: "BJ0001", name: "陈厚酒6年", unit: "瓶", aliases: [] },
        { id: "item-wine-b", code: "BJ0002", name: "赤霞珠干红", unit: "瓶", aliases: [] },
      ],
      learnings: [{ normalizedDescription: "老板接待用酒", normalizedUnit: "瓶", itemId: "item-wine-b", confirmationCount: 3 }],
    });

    expect(result.recommendedItemId).toBe("item-wine-b");
    expect(result.candidates[0]).toMatchObject({ itemId: "item-wine-b", confidence: "HIGH" });
    expect(result.candidates[0]?.reasons).toContain("历史确认 3 次");
  });
});
