export type RecommendationConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface RecommendableItem {
  id: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  aliases: readonly string[];
}

export interface ItemRecommendationLearning {
  normalizedDescription: string;
  normalizedUnit: string;
  itemId: string;
  confirmationCount: number;
}

export interface ItemRecommendationCandidate {
  itemId: string;
  score: number;
  confidence: RecommendationConfidence;
  reasons: string[];
}

export interface ItemRecommendationResult {
  recommendedItemId?: string;
  candidates: ItemRecommendationCandidate[];
}

export function normalizeRecommendationText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s\-_/，,。.;；:：()（）]+/g, "");
}

function confidenceForScore(score: number): RecommendationConfidence {
  if (score >= 90) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

function scoreItem(input: {
  requestedDescription: string;
  normalizedDescription: string;
  normalizedUnit: string;
  item: RecommendableItem;
  learnings: readonly ItemRecommendationLearning[];
}): ItemRecommendationCandidate | null {
  if (normalizeRecommendationText(input.item.unit) !== input.normalizedUnit) return null;

  const reasons: string[] = [];
  let score = 0;
  const normalizedName = normalizeRecommendationText(input.item.name);
  const normalizedCode = normalizeRecommendationText(input.item.code);
  const normalizedSpecification = normalizeRecommendationText(input.item.specification ?? "");
  const exactAlias = input.item.aliases.find((alias) => normalizeRecommendationText(alias) === input.normalizedDescription);
  const partialAlias = input.item.aliases.find((alias) => {
    const normalizedAlias = normalizeRecommendationText(alias);
    return normalizedAlias && (normalizedAlias.includes(input.normalizedDescription) || input.normalizedDescription.includes(normalizedAlias));
  });
  const learning = input.learnings.find((candidate) => candidate.itemId === input.item.id
    && candidate.normalizedDescription === input.normalizedDescription
    && candidate.normalizedUnit === input.normalizedUnit);

  if (learning) {
    score = Math.max(score, 110 + Math.min(learning.confirmationCount, 20));
    reasons.push(`历史确认 ${learning.confirmationCount} 次`);
  }
  if (normalizedName === input.normalizedDescription) {
    score = Math.max(score, 100);
    reasons.push("标准名称完全匹配");
  } else if (exactAlias) {
    score = Math.max(score, 96);
    reasons.push(`别名“${exactAlias}”完全匹配`);
  } else if (normalizedName && (normalizedName.includes(input.normalizedDescription) || input.normalizedDescription.includes(normalizedName))) {
    score += 70;
    reasons.push("标准名称部分匹配");
  } else if (partialAlias) {
    score += 65;
    reasons.push(`别名“${partialAlias}”部分匹配`);
  }

  if (normalizedSpecification && input.normalizedDescription.includes(normalizedSpecification)) {
    score += 20;
    reasons.push("规格匹配");
  }
  if (normalizedCode && input.normalizedDescription.includes(normalizedCode)) {
    score += 55;
    reasons.push("物品编码匹配");
  }
  if (reasons.length === 0) reasons.push("单位一致，需人工确认");

  return { itemId: input.item.id, score, confidence: confidenceForScore(score), reasons };
}

export function recommendStandardItems(input: {
  requestedDescription: string;
  requestedUnit: string;
  items: readonly RecommendableItem[];
  learnings: readonly ItemRecommendationLearning[];
}): ItemRecommendationResult {
  const normalizedDescription = normalizeRecommendationText(input.requestedDescription);
  const normalizedUnit = normalizeRecommendationText(input.requestedUnit);
  const candidates = input.items
    .map((item) => scoreItem({ ...input, normalizedDescription, normalizedUnit, item }))
    .filter((candidate): candidate is ItemRecommendationCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score || left.itemId.localeCompare(right.itemId));
  const first = candidates[0];
  const second = candidates[1];
  const recommendedItemId = first?.confidence === "HIGH" && (!second || first.score - second.score >= 10)
    ? first.itemId
    : undefined;
  return { ...(recommendedItemId ? { recommendedItemId } : {}), candidates };
}
