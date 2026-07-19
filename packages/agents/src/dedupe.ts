import {
  normalizePublicUrl,
  regionalCandidateSchema,
  type RegionalCandidate
} from "@innovateats/shared";

export interface CandidateDuplicate {
  readonly duplicateIndex: number;
  readonly canonicalIndex: number;
  readonly matchedKeys: readonly string[];
  readonly confidence: number;
}

export interface CandidateDedupeResult {
  readonly unique: readonly RegionalCandidate[];
  readonly duplicates: readonly CandidateDuplicate[];
}

export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function candidateKeys(candidate: RegionalCandidate): ReadonlyMap<string, number> {
  const keys = new Map<string, number>();
  for (const sourceUrl of candidate.sourceUrls) {
    keys.set(`domain:${normalizePublicUrl(sourceUrl).domain}`, 1);
  }

  keys.set(`brand:${normalizeEntityName(candidate.brandName)}`, 0.9);
  if (candidate.founder !== undefined) {
    keys.set(
      `founder_product:${normalizeEntityName(candidate.founder)}:${normalizeEntityName(candidate.productOneLiner)}`,
      0.9
    );
  }
  for (const duplicateKey of candidate.duplicateKeys) {
    keys.set(`declared:${normalizeEntityName(duplicateKey)}`, 0.85);
  }
  return keys;
}

function brandNamesAreRelated(left: string, right: string): boolean {
  const leftTokens = normalizeEntityName(left).split(" ").filter(Boolean);
  const rightTokens = normalizeEntityName(right).split(" ").filter(Boolean);
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = new Set(leftTokens.length <= rightTokens.length ? rightTokens : leftTokens);
  return shorter.length > 0 && shorter.every((token) => longer.has(token));
}

export function deduplicateCandidates(
  rawCandidates: readonly RegionalCandidate[]
): CandidateDedupeResult {
  const candidates = rawCandidates.map((candidate) => regionalCandidateSchema.parse(candidate));
  const canonicalIndexes: number[] = [];
  const duplicateRecords: CandidateDuplicate[] = [];
  const keyOwners = new Map<string, { readonly index: number; readonly confidence: number }[]>();

  const registerKey = (key: string, index: number, confidence: number) => {
    const owners = keyOwners.get(key) ?? [];
    const existing = owners.find((owner) => owner.index === index);
    if (existing === undefined) {
      owners.push({ index, confidence });
      keyOwners.set(key, owners);
    }
  };

  candidates.forEach((candidate, index) => {
    const keys = candidateKeys(candidate);
    const matches = [...keys.entries()]
      .flatMap(([key, confidence]) => {
        const owners = keyOwners.get(key) ?? [];
        return owners.flatMap((owner) => {
          const domainMatchAllowed =
            !key.startsWith("domain:") ||
            brandNamesAreRelated(
              candidate.brandName,
              (candidates[owner.index] as RegionalCandidate).brandName
            );
          return domainMatchAllowed
            ? [
                {
                  key,
                  canonicalIndex: owner.index,
                  confidence: Math.min(confidence, owner.confidence)
                }
              ]
            : [];
        });
      })
      .sort((left, right) => right.confidence - left.confidence);

    const strongest = matches[0];
    if (strongest !== undefined && strongest.confidence >= 0.85) {
      duplicateRecords.push({
        duplicateIndex: index,
        canonicalIndex: strongest.canonicalIndex,
        matchedKeys: [
          ...new Set(
            matches
              .filter((match) => match.canonicalIndex === strongest.canonicalIndex)
              .map((match) => match.key)
          )
        ],
        confidence: strongest.confidence
      });
      for (const [key, confidence] of keys) {
        registerKey(key, strongest.canonicalIndex, Math.min(confidence, strongest.confidence));
      }
      return;
    }

    canonicalIndexes.push(index);
    for (const [key, confidence] of keys) {
      registerKey(key, index, confidence);
    }
  });

  return {
    unique: canonicalIndexes.map((index) => candidates[index] as RegionalCandidate),
    duplicates: duplicateRecords
  };
}
