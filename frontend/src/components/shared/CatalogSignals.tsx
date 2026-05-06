import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  CatalogModel,
  CatalogPricingTrust,
  CatalogProvider,
  CatalogProviderStatus,
  NodeInfo,
} from "@/types/api";

type RecommendedProviderModel = {
  model: CatalogModel;
  buckets: string[];
  source: "recommended" | "fallback";
  releaseDate: string | null;
  hasPricing: boolean;
};

function safeProviderStatus(
  provider: Pick<CatalogProvider, "provider_status" | "status">,
): CatalogProviderStatus {
  return provider.provider_status || provider.status || "active";
}

export function providerStatusValue(
  provider: Pick<CatalogProvider, "provider_status" | "status">,
): CatalogProviderStatus {
  return safeProviderStatus(provider);
}

export function modelReleaseDate(model: CatalogModel): string | null {
  return (
    model.lifecycle?.release_date ||
    model.enrichment?.lifecycle?.release_date ||
    model.enrichment?.release_date ||
    model.lifecycle?.announcement_date ||
    model.enrichment?.lifecycle?.announcement_date ||
    model.enrichment?.announcement_date ||
    null
  );
}

export function modelThroughput(model: CatalogModel): number | null {
  return (
    model.specs?.throughput ||
    model.enrichment?.specs?.throughput ||
    model.enrichment?.throughput ||
    null
  );
}

export function topBenchmarkSnippets(model: CatalogModel) {
  const benchmarks =
    model.benchmarks || model.enrichment?.benchmarks || {};
  const definitions = [
    ["gpqa_score", "GPQA"],
    ["swe_bench_verified_score", "SWE-bench"],
    ["mmmu_score", "MMMU"],
    ["browsecomp_score", "BrowseComp"],
  ] as const;
  return definitions.flatMap(([key, label]) => {
    const raw = benchmarks[key];
    if (raw === null || raw === undefined) return [];
    if (raw <= 1) {
      return [{ key, label, value: `${Math.round(raw * 100)}%` }];
    }
    return [{ key, label, value: `${raw}` }];
  });
}

export function recommendedModelsForProvider(
  provider: CatalogProvider,
): RecommendedProviderModel[] {
  const modelById = new Map(provider.models.map((model) => [model.id, model]));
  const bucketByModel = new Map<string, string[]>();
  const sourceByModel = new Map<string, "recommended" | "fallback">();

  for (const entry of provider.recommended_models || []) {
    const buckets = bucketByModel.get(entry.model_id) || [];
    if (!buckets.includes(entry.bucket)) buckets.push(entry.bucket);
    bucketByModel.set(entry.model_id, buckets);
    sourceByModel.set(entry.model_id, entry.source);
  }

  const orderedIds = (provider.recommended_models || []).map(
    (entry) => entry.model_id,
  );
  const fallbackIds = Object.values(
    provider.recommended_model_buckets || {},
  ).flat();

  return Array.from(new Set([...orderedIds, ...fallbackIds]))
    .map((id) => {
      const model = modelById.get(id);
      if (!model) return null;
      return {
        model,
        buckets: bucketByModel.get(id) || [],
        source: sourceByModel.get(id) || "fallback",
        releaseDate: modelReleaseDate(model),
        hasPricing: Boolean(model.pricing_sources?.effective?.has_pricing),
      };
    })
    .filter(
      (item): item is RecommendedProviderModel => item !== null,
    );
}

export function providerHasOpenRouterReference(provider: CatalogProvider): boolean {
  return provider.models.some(
    (model) =>
      model.pricing_sources?.primary_reference_source === "openrouter-public-api",
  );
}

export function providerHasZeroEvalSecondary(provider: CatalogProvider): boolean {
  return provider.models.some(
    (model) => model.pricing_sources?.secondary_reference_source === "zeroeval",
  );
}

export function providerNeedsPricingReview(provider: CatalogProvider): boolean {
  const summary = provider.pricing_trust_summary;
  if (summary) {
    return summary.review_required_models > 0;
  }
  if (provider.manual_review_required || provider.pricing?.manual_review_required) {
    return true;
  }
  return provider.models.some(
    (model) =>
      model.pricing?.manual_review_required ||
      model.pricing_sources?.effective?.manual_review_required ||
      model.pricing_sources?.secondary_reference?.manual_review_required,
  );
}

export function hasCanonicalCoverage(provider: CatalogProvider): boolean {
  return Boolean(provider.canonical_model_coverage?.canonicalized_models);
}

export function hasPricingCoverage(provider: CatalogProvider): boolean {
  return Boolean(
    provider.pricing_coverage?.estimate_ready_models ??
      provider.pricing_coverage?.priced_models,
  );
}

export function providerPricingTrustStatus(
  provider: CatalogProvider,
): CatalogPricingTrust {
  return (
    provider.pricing_trust_summary?.status ||
    (provider.pricing_coverage?.priced_models ? "reference_estimate" : "missing")
  );
}

function pricingTrustVariant(
  status: CatalogPricingTrust,
): "zinc" | "emerald" | "amber" | "blue" | "red" {
  if (status === "aligned_estimate") return "emerald";
  if (status === "reference_estimate") return "blue";
  if (status === "review_required") return "amber";
  return "red";
}

export function matchCatalogProviderForNode(
  node: Pick<NodeInfo, "id" | "base_url">,
  providers: CatalogProvider[],
): CatalogProvider | undefined {
  const normalizedId = node.id.trim().toLowerCase();
  const matchedById = providers.find((provider) => {
    if (provider.id.toLowerCase() === normalizedId) return true;
    return (provider.aliases || []).some(
      (alias) => alias.trim().toLowerCase() === normalizedId,
    );
  });
  if (matchedById) return matchedById;

  let nodeHost = "";
  try {
    nodeHost = new URL(node.base_url).hostname.toLowerCase();
  } catch {
    nodeHost = node.base_url.trim().toLowerCase();
  }
  if (!nodeHost) return undefined;

  return providers.find((provider) =>
    (provider.base_url_matchers || []).some(
      (matcher) => matcher.trim().toLowerCase() === nodeHost,
    ),
  );
}

export function CatalogCoveragePills({
  provider,
  dense = false,
  className,
}: {
  provider: CatalogProvider;
  dense?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("nodes");
  const canonical = provider.canonical_model_coverage;
  const pricing = provider.pricing_coverage;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      <Badge variant={hasCanonicalCoverage(provider) ? "emerald" : "zinc"} className={dense ? "text-[9px]" : undefined}>
        {t("catalogSignals.canonicalCoverage", {
          mapped: canonical?.canonicalized_models ?? 0,
          total: canonical?.total_models ?? provider.models.length,
        })}
      </Badge>
      <Badge variant={hasPricingCoverage(provider) ? "blue" : "amber"} className={dense ? "text-[9px]" : undefined}>
        {t("catalogSignals.pricingCoverage", {
          estimate:
            pricing?.estimate_ready_models ?? pricing?.priced_models ?? 0,
          priced: pricing?.priced_models ?? 0,
          total: pricing?.total_models ?? provider.models.length,
        })}
      </Badge>
      {(canonical?.low_confidence_models || 0) > 0 && (
        <Badge variant="amber" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.lowConfidence", {
            count: canonical?.low_confidence_models ?? 0,
          })}
        </Badge>
      )}
    </div>
  );
}

export function CatalogTrustPills({
  provider,
  dense = false,
  showExplicitWins = true,
  className,
}: {
  provider: CatalogProvider;
  dense?: boolean;
  showExplicitWins?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("nodes");
  const hasOpenRouter = providerHasOpenRouterReference(provider);
  const hasZeroEval = providerHasZeroEvalSecondary(provider);
  const needsReview = providerNeedsPricingReview(provider);
  const summary = provider.pricing_trust_summary;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {summary && summary.aligned_estimate_models > 0 && (
        <Badge variant="emerald" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.alignedEstimate", {
            count: summary.aligned_estimate_models,
          })}
        </Badge>
      )}
      {summary && summary.reference_estimate_models > 0 && (
        <Badge variant="blue" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.referenceEstimate", {
            count: summary.reference_estimate_models,
          })}
        </Badge>
      )}
      {summary && summary.missing_models > 0 && (
        <Badge variant="zinc" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.missingPricing", {
            count: summary.missing_models,
          })}
        </Badge>
      )}
      {hasOpenRouter && (
        <Badge variant="blue" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.openrouterReference")}
        </Badge>
      )}
      {hasZeroEval && (
        <Badge variant="amber" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.zeroevalSecondary")}
        </Badge>
      )}
      {(summary?.review_required_models || 0) > 0 && (
        <Badge variant="amber" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.reviewRequiredCount", {
            count: summary?.review_required_models ?? 0,
          })}
        </Badge>
      )}
      {!summary && needsReview && (
        <Badge variant="amber" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.reviewRequired")}
        </Badge>
      )}
      {showExplicitWins && (
        <Badge variant="zinc" className={dense ? "text-[9px]" : undefined}>
          {t("catalogSignals.explicitPricingWins")}
        </Badge>
      )}
    </div>
  );
}

export function PricingTrustBadge({
  status,
  dense = false,
  count,
  className,
}: {
  status: CatalogPricingTrust;
  dense?: boolean;
  count?: number;
  className?: string;
}) {
  const { t } = useTranslation("nodes");
  if (count === undefined) {
    return (
      <Badge
        variant={pricingTrustVariant(status)}
        className={cn(dense ? "text-[9px]" : undefined, className)}
      >
        {t(`catalogPage.pricingTrust.${status}`)}
      </Badge>
    );
  }
  const key =
    status === "aligned_estimate"
      ? "catalogSignals.alignedEstimate"
      : status === "reference_estimate"
        ? "catalogSignals.referenceEstimate"
        : status === "review_required"
          ? "catalogSignals.reviewRequiredCount"
          : "catalogSignals.missingPricing";
  return (
    <Badge
      variant={pricingTrustVariant(status)}
      className={cn(dense ? "text-[9px]" : undefined, className)}
    >
      {t(key, { count })}
    </Badge>
  );
}

export function RecommendedModelChips({
  provider,
  limit = 3,
  dense = false,
  className,
}: {
  provider: CatalogProvider;
  limit?: number;
  dense?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("nodes");
  const recommended = recommendedModelsForProvider(provider).slice(0, limit);
  if (recommended.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {recommended.map(({ model, source }) => (
        <Badge
          key={model.id}
          variant={source === "recommended" ? "emerald" : "zinc"}
          className={cn(
            "max-w-full truncate font-mono",
            dense ? "text-[8px]" : "text-[9px]",
          )}
          title={model.display_name || model.id}
        >
          {model.id}
        </Badge>
      ))}
      {provider.recommended_models && provider.recommended_models.length > limit && (
        <Badge variant="zinc" className={dense ? "text-[8px]" : "text-[9px]"}>
          {t("catalogSignals.moreRecommended", {
            count: provider.recommended_models.length - limit,
          })}
        </Badge>
      )}
    </div>
  );
}

export function ProviderStatusBadge({
  provider,
  dense = false,
}: {
  provider: CatalogProvider;
  dense?: boolean;
}) {
  const { t } = useTranslation("nodes");
  const status = safeProviderStatus(provider);
  const variant =
    status === "active"
      ? "emerald"
      : status === "deprecated"
        ? "amber"
        : status === "transport_only" || status === "legacy_alias"
          ? "zinc"
          : "blue";
  return (
    <Badge variant={variant} className={dense ? "text-[9px]" : undefined}>
      {t(`catalogPage.providerStatus.${status}`, {
        defaultValue: status,
      })}
    </Badge>
  );
}
