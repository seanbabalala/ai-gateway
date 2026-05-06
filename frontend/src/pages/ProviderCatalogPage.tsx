import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Filter,
  Layers3,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Tag,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  CatalogCoveragePills,
  CatalogTrustPills,
  ProviderStatusBadge,
  RecommendedModelChips,
  modelReleaseDate,
  modelThroughput,
  providerStatusValue,
  recommendedModelsForProvider,
  topBenchmarkSnippets,
} from "@/components/shared/CatalogSignals";
import { NodeIcon } from "@/components/shared/NodeIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useProviderCatalogProviders } from "@/hooks/use-provider-catalog";
import { cn } from "@/lib/utils";
import type {
  CatalogCompatibilityProfile,
  CatalogModel,
  CatalogPricingHygiene,
  CatalogProvider,
  CatalogProviderFamily,
  CatalogProvidersResponse,
  CatalogProviderType,
  CatalogSyncStatus,
} from "@/types/api";

const MODALITY_FILTERS = [
  "all",
  "text",
  "vision",
  "image",
  "audio",
  "video",
  "embedding",
  "rerank",
  "realtime",
  "batch",
] as const;

const PROVIDER_FAMILIES: CatalogProviderFamily[] = [
  "foundation",
  "aggregators",
  "cloud",
  "china",
  "self_hosted",
  "image_video",
  "speech_audio",
  "embedding_rerank",
];

const PROVIDER_TYPES: CatalogProviderType[] = [
  "direct",
  "aggregator",
  "cloud",
  "self_hosted",
  "media",
  "speech",
  "local",
  "compatible",
  "custom",
];

const COMPATIBILITY_PROFILES: CatalogCompatibilityProfile[] = [
  "openai-compatible",
  "anthropic-compatible",
  "google-compatible",
  "native",
  "local",
  "custom",
];

const MODEL_BUCKET_LABELS = [
  "models",
  "embedding_models",
  "rerank_models",
  "image_models",
  "audio_models",
  "video_models",
  "realtime_models",
  "batch_models",
] as const;

type PricingStatus = CatalogPricingHygiene["status"] | "review";
type PricingFilter = "all" | PricingStatus;
type QuickFilter = "none" | "review" | "stale";

function modelPricingStatus(model: CatalogModel): PricingStatus {
  const hygiene = model.pricing_hygiene;
  if (!hygiene)
    return model.pricing?.manual_review_required ? "review" : "fresh";
  if (hygiene.manual_review_required && hygiene.status === "fresh")
    return "review";
  return hygiene.status;
}

function providerPricingStatus(provider: CatalogProvider): PricingStatus {
  const statuses = [
    provider.pricing_hygiene?.status,
    ...provider.models.map((model) => modelPricingStatus(model)),
  ].filter(Boolean) as PricingStatus[];
  if (statuses.includes("invalid")) return "invalid";
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("stale")) return "stale";
  if (
    provider.manual_review_required ||
    provider.pricing?.manual_review_required ||
    statuses.includes("review") ||
    statuses.includes("placeholder")
  ) {
    return "review";
  }
  return "fresh";
}

function statusVariant(status: PricingStatus) {
  if (status === "fresh") return "emerald";
  if (status === "stale") return "amber";
  if (status === "missing" || status === "invalid") return "red";
  return "amber";
}

function sourceLabel(source: string | null | undefined) {
  if (!source) return "other";
  if (
    source === "builtin-reference" ||
    source === "builtin-static-placeholder" ||
    source === "provider-reference"
  )
    return "builtinReference";
  if (source === "openrouter-public-api") return "openrouterApi";
  if (source === "operator_required") return "operatorRequired";
  if (source.includes("override")) return "localOverride";
  return "other";
}

function sourceVariant(
  source: string | null | undefined,
): "zinc" | "emerald" | "amber" | "blue" {
  if (source === "openrouter-public-api") return "emerald";
  if (
    source === "builtin-reference" ||
    source === "builtin-static-placeholder" ||
    source === "provider-reference"
  )
    return "blue";
  if (!source || source === "operator_required") return "amber";
  return "zinc";
}

function refreshSourceVariant(
  source: NonNullable<CatalogProvidersResponse["refresh_sources"]>[number],
): "zinc" | "emerald" | "amber" | "blue" {
  if (source.automatic) return "emerald";
  if (source.mode === "docs_review") return "blue";
  if (source.mode === "operator_local") return "amber";
  return "zinc";
}

function syncStatusVariant(
  status: CatalogSyncStatus["providers"][number]["status"],
): "zinc" | "emerald" | "amber" | "red" | "blue" {
  if (status === "fresh" || status === "synced") return "emerald";
  if (status === "stale" || status === "never_synced") return "amber";
  if (status === "failed") return "red";
  if (status === "manual_only") return "blue";
  return "zinc";
}

function friendlyUnit(unit: string) {
  const normalized = unit.replace(/^usd_per_/, "").replaceAll("_", " ");
  if (normalized === "-") return "-";
  return normalized
    .replace("1m input tokens", "/ 1M input tokens")
    .replace("1m output tokens", "/ 1M output tokens")
    .replace("1m tokens", "/ 1M tokens");
}

function providerFamily(provider: CatalogProvider): CatalogProviderFamily {
  return provider.family || "foundation";
}

function providerType(provider: CatalogProvider): CatalogProviderType {
  return (
    provider.provider_type ||
    (provider.allows_unknown_models ? "compatible" : "direct")
  );
}

function providerCompatibility(provider: CatalogProvider): string {
  return provider.compatibility_profile || "native";
}

function providerSearchText(provider: CatalogProvider) {
  return [
    provider.id,
    provider.name,
    provider.display_name,
    provider.base_url,
    provider.provider_type,
    provider.compatibility_profile,
    ...(provider.aliases || []),
    ...(provider.tags || []),
    ...(provider.model_prefixes || []),
    ...(provider.capabilities || []),
    ...provider.models.flatMap((model) => [
      model.id,
      model.display_name || "",
      ...model.capabilities,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function modelMatches(model: CatalogModel, query: string, modality: string) {
  const q = query.trim().toLowerCase();
  const matchesQuery =
    q.length === 0 ||
    model.id.toLowerCase().includes(q) ||
    model.provider_id.toLowerCase().includes(q) ||
    model.capabilities.some((capability) =>
      capability.toLowerCase().includes(q),
    );
  const matchesModality =
    modality === "all" || (model.modalities as string[]).includes(modality);
  return matchesQuery && matchesModality;
}

function providerMatches({
  provider,
  query,
  modality,
  family,
  type,
  pricing,
  compatibility,
  quickFilter,
}: {
  provider: CatalogProvider;
  query: string;
  modality: string;
  family: string;
  type: string;
  pricing: PricingFilter;
  compatibility: string;
  quickFilter: QuickFilter;
}) {
  const status = providerPricingStatus(provider);
  const q = query.trim().toLowerCase();
  const queryMatches =
    q.length === 0 ||
    providerSearchText(provider).includes(q) ||
    provider.models.some((model) => modelMatches(model, q, "all"));
  const modalityMatches =
    modality === "all" ||
    provider.modalities.includes(modality as never) ||
    provider.models.some((model) =>
      model.modalities.includes(modality as never),
    );
  const familyMatches = family === "all" || providerFamily(provider) === family;
  const typeMatches = type === "all" || providerType(provider) === type;
  const pricingMatches =
    pricing === "all" ||
    status === pricing ||
    (pricing === "review" && provider.manual_review_required);
  const compatibilityMatches =
    compatibility === "all" ||
    providerCompatibility(provider) === compatibility;
  const quickMatches =
    quickFilter === "none" ||
    (quickFilter === "review" &&
      (status === "review" || provider.manual_review_required)) ||
    (quickFilter === "stale" && status === "stale");
  return (
    queryMatches &&
    modalityMatches &&
    familyMatches &&
    typeMatches &&
    pricingMatches &&
    compatibilityMatches &&
    quickMatches
  );
}

function primaryEndpoints(provider: CatalogProvider) {
  return Object.keys(provider.endpoints || {}).filter((endpoint) =>
    Boolean(provider.endpoints[endpoint as keyof typeof provider.endpoints]),
  );
}

function formatBytes(value?: number | null) {
  if (value === null || value === undefined) return "-";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function formatCompactNumber(value?: number | null) {
  if (value === null || value === undefined) return "-";
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function useFilteredCatalog(providers: CatalogProvider[]) {
  const [query, setQuery] = useState("");
  const [modality, setModality] =
    useState<(typeof MODALITY_FILTERS)[number]>("all");
  const [family, setFamily] = useState<"all" | CatalogProviderFamily>("all");
  const [type, setType] = useState<"all" | CatalogProviderType>("all");
  const [pricing, setPricing] = useState<PricingFilter>("all");
  const [compatibility, setCompatibility] = useState<"all" | string>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("none");

  const filteredProviders = useMemo(
    () =>
      providers.filter((provider) =>
        providerMatches({
          provider,
          query,
          modality,
          family,
          type,
          pricing,
          compatibility,
          quickFilter,
        }),
      ),
    [
      providers,
      query,
      modality,
      family,
      type,
      pricing,
      compatibility,
      quickFilter,
    ],
  );

  return {
    query,
    setQuery,
    modality,
    setModality,
    family,
    setFamily,
    type,
    setType,
    pricing,
    setPricing,
    compatibility,
    setCompatibility,
    quickFilter,
    setQuickFilter,
    filteredProviders,
  };
}

export function ProviderCatalogPage() {
  const { t } = useTranslation("nodes");
  const [showLegacyProviders, setShowLegacyProviders] = useState(false);
  const catalog = useProviderCatalogProviders({ showLegacy: showLegacyProviders });
  const providers = catalog.data?.providers || [];
  const allModels = providers.flatMap((provider) => provider.models);
  const explorer = useFilteredCatalog(providers);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [expandedFamilies, setExpandedFamilies] = useState<
    Set<CatalogProviderFamily>
  >(() => new Set(["foundation", "aggregators", "china"]));

  const visibleProviders = explorer.filteredProviders;
  const selectedProvider =
    visibleProviders.find((provider) => provider.id === selectedProviderId) ||
    visibleProviders[0] ||
    null;
  const staleCount = providers.filter(
    (provider) => providerPricingStatus(provider) === "stale",
  ).length;
  const reviewCount = providers.filter(
    (provider) => providerPricingStatus(provider) === "review",
  ).length;
  const noPricingCount = providers.filter(
    (provider) => providerPricingStatus(provider) === "missing",
  ).length;
  const overriddenCount =
    providers.filter(
      (provider) => provider.overridden || provider.tags?.includes("override"),
    ).length + allModels.filter((model) => model.overridden).length;
  const compatibilityProfileCount =
    catalog.data?.compatibility_profiles?.length || 0;

  const groupedProviders = useMemo(
    () =>
      PROVIDER_FAMILIES.map((item) => ({
        family: item,
        providers: visibleProviders.filter(
          (provider) => providerFamily(provider) === item,
        ),
      })).filter((group) => group.providers.length > 0),
    [visibleProviders],
  );

  useEffect(() => {
    if (visibleProviders.length === 0) {
      setSelectedProviderId(null);
      return;
    }
    if (
      !selectedProviderId ||
      !visibleProviders.some((provider) => provider.id === selectedProviderId)
    ) {
      setSelectedProviderId(visibleProviders[0].id);
    }
  }, [selectedProviderId, visibleProviders]);

  const toggleFamily = (family: CatalogProviderFamily) => {
    setExpandedFamilies((current) => {
      const next = new Set(current);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("catalogPage.title")}
        description={t("catalogPage.description")}
        icon={Boxes}
      >
        <Button
          variant={showLegacyProviders ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowLegacyProviders((current) => !current)}
        >
          {t(
            showLegacyProviders
              ? "catalogPage.filters.hideLegacy"
              : "catalogPage.filters.showLegacy",
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => catalog.refetch()}
          disabled={catalog.isFetching}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", catalog.isFetching && "animate-spin")}
          />
          {t("catalogPage.refresh")}
        </Button>
      </PageHeader>

      {catalog.isLoading && (
        <div className="grid gap-4 md:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {catalog.isError && (
        <ErrorState
          error={
            catalog.error instanceof Error
              ? catalog.error
              : new Error(t("catalogPage.errorMessage"))
          }
          onRetry={() => {
            void catalog.refetch();
          }}
        />
      )}

      {catalog.data && (
        <>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
            <CatalogMetric
              label={t("catalogPage.metrics.providers")}
              value={providers.length}
              icon={Boxes}
            />
            <CatalogMetric
              label={t("catalogPage.metrics.models")}
              value={allModels.length}
              icon={Tag}
            />
            <CatalogMetric
              label={t("catalogPage.metrics.families")}
              value={new Set(providers.map(providerFamily)).size}
              icon={Layers3}
            />
            <CatalogMetric
              label={t("catalogPage.metrics.compatibilityProfiles")}
              value={compatibilityProfileCount}
              icon={ShieldCheck}
              tone="emerald"
            />
            <CatalogMetric
              label={t("catalogPage.metrics.overrides")}
              value={overriddenCount}
              icon={Tag}
              tone={overriddenCount > 0 ? "emerald" : "zinc"}
            />
            <CatalogMetric
              label={t("catalogPage.metrics.review")}
              value={reviewCount}
              icon={WalletCards}
              tone={reviewCount > 0 ? "amber" : "emerald"}
            />
            <CatalogMetric
              label={t("catalogPage.metrics.stale")}
              value={staleCount + noPricingCount}
              icon={WalletCards}
              tone={staleCount + noPricingCount > 0 ? "amber" : "emerald"}
            />
          </div>

          {catalog.data.sync_status && (
            <CatalogSyncStatusCard status={catalog.data.sync_status} />
          )}

          <CatalogRefreshSources sources={catalog.data.refresh_sources || []} />

          <Card>
            <CardHeader className="gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>{t("catalogPage.explorer.title")}</CardTitle>
                  <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--foreground-dim)]">
                    {t("catalogPage.explorer.description", {
                      file:
                        catalog.data.override_file || "catalog.override.yaml",
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 lg:justify-end">
                  <Badge variant={noPricingCount > 0 ? "red" : "emerald"}>
                    {t("catalogPage.filters.noPricingCount", {
                      count: noPricingCount,
                    })}
                  </Badge>
                  <Badge variant={reviewCount > 0 ? "amber" : "emerald"}>
                    {t("catalogPage.filters.reviewCount", {
                      count: reviewCount,
                    })}
                  </Badge>
                  <Badge
                    variant={
                      visibleProviders.length === providers.length
                        ? "zinc"
                        : "blue"
                    }
                  >
                    {t("catalogPage.filters.visibleCount", {
                      count: visibleProviders.length,
                      total: providers.length,
                    })}
                  </Badge>
                  <Badge variant={showLegacyProviders ? "amber" : "zinc"}>
                    {t(
                      showLegacyProviders
                        ? "catalogPage.filters.legacyShown"
                        : "catalogPage.filters.activeOnly",
                    )}
                  </Badge>
                </div>
              </div>
              <CatalogFilters explorer={explorer} />
            </CardHeader>
            <CardContent>
              {visibleProviders.length === 0 ? (
                <EmptyState
                  title={t("catalogPage.emptyTitle")}
                  description={t("catalogPage.emptyDescription")}
                  icon={Boxes}
                />
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
                  <div className="space-y-3">
                    {groupedProviders.map((group) => (
                      <ProviderFamilyGroup
                        key={group.family}
                        family={group.family}
                        providers={group.providers}
                        expanded={expandedFamilies.has(group.family)}
                        selectedProviderId={selectedProvider?.id || null}
                        onToggle={() => toggleFamily(group.family)}
                        onSelect={setSelectedProviderId}
                      />
                    ))}
                  </div>
                  <ProviderDetailPanel
                    provider={selectedProvider}
                    syncStatus={catalog.data.sync_status}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function CatalogFilters({
  explorer,
}: {
  explorer: ReturnType<typeof useFilteredCatalog>;
}) {
  const { t } = useTranslation("nodes");
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-3">
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--foreground-dim)]" />
          <Input
            value={explorer.query}
            onChange={(event) => explorer.setQuery(event.target.value)}
            placeholder={t("catalogPage.search")}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["none", "review", "stale"] as QuickFilter[]).map((filter) => (
            <FilterButton
              key={filter}
              active={explorer.quickFilter === filter}
              onClick={() => explorer.setQuickFilter(filter)}
            >
              {t(`catalogPage.quickFilters.${filter}`)}
            </FilterButton>
          ))}
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <FilterGroup icon={Layers3} label={t("catalogPage.filters.family")}>
          <FilterButton
            active={explorer.family === "all"}
            onClick={() => explorer.setFamily("all")}
          >
            {t("catalogPage.filters.all")}
          </FilterButton>
          {PROVIDER_FAMILIES.map((family) => (
            <FilterButton
              key={family}
              active={explorer.family === family}
              onClick={() => explorer.setFamily(family)}
            >
              {t(`catalogPage.family.${family}`)}
            </FilterButton>
          ))}
        </FilterGroup>
        <FilterGroup icon={Tag} label={t("catalogPage.filters.modality")}>
          {MODALITY_FILTERS.map((item) => (
            <FilterButton
              key={item}
              active={explorer.modality === item}
              onClick={() => explorer.setModality(item)}
            >
              {t(`catalogPage.modalities.${item}`)}
            </FilterButton>
          ))}
        </FilterGroup>
        <FilterGroup
          icon={Server}
          label={t("catalogPage.filters.providerType")}
        >
          <FilterButton
            active={explorer.type === "all"}
            onClick={() => explorer.setType("all")}
          >
            {t("catalogPage.filters.all")}
          </FilterButton>
          {PROVIDER_TYPES.map((type) => (
            <FilterButton
              key={type}
              active={explorer.type === type}
              onClick={() => explorer.setType(type)}
            >
              {t(`catalogPage.providerTypes.${type}`)}
            </FilterButton>
          ))}
        </FilterGroup>
        <FilterGroup
          icon={Filter}
          label={t("catalogPage.filters.pricingStatus")}
        >
          {(
            ["all", "fresh", "review", "stale", "missing"] as PricingFilter[]
          ).map((status) => (
            <FilterButton
              key={status}
              active={explorer.pricing === status}
              onClick={() => explorer.setPricing(status)}
            >
              {status === "all"
                ? t("catalogPage.filters.all")
                : t(`catalogPage.status.${status}`)}
            </FilterButton>
          ))}
        </FilterGroup>
        <FilterGroup
          icon={Layers3}
          label={t("catalogPage.filters.compatibility")}
        >
          <FilterButton
            active={explorer.compatibility === "all"}
            onClick={() => explorer.setCompatibility("all")}
          >
            {t("catalogPage.filters.all")}
          </FilterButton>
          {COMPATIBILITY_PROFILES.map((profile) => (
            <FilterButton
              key={profile}
              active={explorer.compatibility === profile}
              onClick={() => explorer.setCompatibility(profile)}
            >
              {t(`catalogPage.compatibility.${profile}`)}
            </FilterButton>
          ))}
        </FilterGroup>
      </div>
    </div>
  );
}

function FilterGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Boxes;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "max-w-full rounded-md px-2.5 py-1.5 text-[11px] font-bold transition-all",
        active
          ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
          : "bg-[var(--background-tertiary)]/70 text-[var(--foreground-dim)] hover:text-[var(--foreground)]",
      )}
    >
      <span className="block truncate">{children}</span>
    </button>
  );
}

function ProviderFamilyGroup({
  family,
  providers,
  expanded,
  selectedProviderId,
  onToggle,
  onSelect,
}: {
  family: CatalogProviderFamily;
  providers: CatalogProvider[];
  expanded: boolean;
  selectedProviderId: string | null;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("nodes");
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background-secondary)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 text-left transition-colors hover:bg-[var(--inset-bg)]"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-extrabold text-[var(--foreground)]">
            {t(`catalogPage.family.${family}`)}
          </span>
          <span className="mt-0.5 block text-[11px] font-medium text-[var(--foreground-dim)]">
            {t("catalogPage.familyCount", { count: providers.length })}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant="zinc">{providers.length}</Badge>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[var(--foreground-dim)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[var(--foreground-dim)]" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="divide-y divide-[var(--border)]">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              selected={provider.id === selectedProviderId}
              onSelect={() => onSelect(provider.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProviderRow({
  provider,
  selected,
  onSelect,
}: {
  provider: CatalogProvider;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("nodes");
  const status = providerPricingStatus(provider);
  const endpoints = primaryEndpoints(provider).slice(0, 4);
  const modelCount = provider.models.length;
  const recommendedPreview = recommendedModelsForProvider(provider).slice(0, 3);
  const providerStatus = providerStatusValue(provider);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full gap-3 px-4 py-3 text-left transition-all lg:grid-cols-[minmax(220px,1.15fr)_minmax(180px,0.9fr)_minmax(210px,1fr)_minmax(220px,1fr)] lg:items-center",
        selected ? "bg-[var(--accent-muted)]" : "hover:bg-[var(--inset-bg)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
          <NodeIcon
            providerId={provider.logo_id || provider.id}
            providerName={provider.display_name || provider.name}
            baseUrl={provider.base_url}
            modelIds={provider.models.map((model) => model.id)}
            tags={provider.tags}
            protocol={provider.default_protocol}
            className="h-5 w-5"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-extrabold text-[var(--foreground)]">
            {provider.display_name || provider.name}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--foreground-dim)]">
            {provider.id}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        <Badge
          variant={providerType(provider) === "custom" ? "purple" : "zinc"}
          className="max-w-[120px] truncate whitespace-nowrap"
        >
          {t(`catalogPage.providerTypes.${providerType(provider)}`)}
        </Badge>
        <Badge
          variant="blue"
          className="max-w-[150px] truncate whitespace-nowrap"
        >
          {t(`catalogPage.compatibility.${providerCompatibility(provider)}`, {
            defaultValue: providerCompatibility(provider),
          })}
        </Badge>
        {providerStatus !== "active" && <ProviderStatusBadge provider={provider} dense />}
      </div>
      <div className="min-w-0 space-y-1.5">
        <CatalogCoveragePills provider={provider} dense />
        <CatalogTrustPills provider={provider} dense />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap gap-1">
          <Badge variant={statusVariant(status)} className="whitespace-nowrap">
            {t(`catalogPage.status.${status}`)}
          </Badge>
          <Badge
            variant={sourceVariant(provider.pricing?.source)}
            className="max-w-[150px] truncate whitespace-nowrap"
          >
            {t(`catalogPage.sources.${sourceLabel(provider.pricing?.source)}`, {
              source: provider.pricing?.source || "-",
              defaultValue: provider.pricing?.source || "-",
            })}
          </Badge>
          {provider.overridden && (
            <Badge variant="purple">{t("catalogPage.badges.override")}</Badge>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10px] text-[var(--foreground-dim)]">
          <span>{t("catalogPage.row.models", { count: modelCount })}</span>
          {recommendedPreview.length > 0 && (
            <span>{t("catalogSignals.recommendedPreview")}</span>
          )}
          <span className="truncate">
            {endpoints.length > 0
              ? endpoints.join(", ")
              : t("catalogPage.row.noEndpoint")}
          </span>
        </div>
        {recommendedPreview.length > 0 && (
          <RecommendedModelChips provider={provider} limit={3} dense />
        )}
      </div>
    </button>
  );
}

function ProviderDetailPanel({
  provider,
  syncStatus,
}: {
  provider: CatalogProvider | null;
  syncStatus?: CatalogSyncStatus;
}) {
  const { t } = useTranslation("nodes");
  if (!provider) {
    return (
      <aside className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] p-5">
        <EmptyState
          title={t("catalogPage.detail.emptyTitle")}
          description={t("catalogPage.detail.emptyDescription")}
          icon={Server}
        />
      </aside>
    );
  }

  const status = providerPricingStatus(provider);
  const sync = syncStatus?.providers.find(
    (entry) => entry.provider === provider.id,
  );
  const buckets = provider.model_buckets || {
    models: provider.models.map((model) => model.id),
    embedding_models: [],
    rerank_models: [],
    image_models: [],
    audio_models: [],
    video_models: [],
    realtime_models: [],
    batch_models: [],
  };
  const pricingUnits =
    provider.pricing_units ||
    provider.pricing?.units ||
    (provider.pricing?.unit ? { default: provider.pricing.unit } : {});
  const endpoints = Object.entries(provider.endpoints || {}).filter(
    ([, value]) => Boolean(value),
  );
  const capabilities = provider.capabilities || [];
  const recommendedModels = recommendedModelsForProvider(provider);
  const providerStatus = providerStatusValue(provider);

  return (
    <aside className="h-fit rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] xl:sticky xl:top-4">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
            <NodeIcon
              providerId={provider.logo_id || provider.id}
              providerName={provider.display_name || provider.name}
              baseUrl={provider.base_url}
              modelIds={provider.models.map((model) => model.id)}
              tags={provider.tags}
              protocol={provider.default_protocol}
              className="h-6 w-6"
            />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold text-[var(--foreground)]">
              {provider.display_name || provider.name}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--foreground-dim)]">
              {provider.base_url}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant={statusVariant(status)}>
            {t(`catalogPage.status.${status}`)}
          </Badge>
          <ProviderStatusBadge provider={provider} />
          <Badge variant="zinc">
            {t(`catalogPage.family.${providerFamily(provider)}`)}
          </Badge>
          <Badge
            variant={providerType(provider) === "custom" ? "purple" : "blue"}
          >
            {t(`catalogPage.providerTypes.${providerType(provider)}`)}
          </Badge>
          {provider.manual_review_required && (
            <Badge variant="amber">{t("catalogPage.badges.review")}</Badge>
          )}
          {provider.overridden && (
            <Badge variant="purple">{t("catalogPage.badges.override")}</Badge>
          )}
        </div>
        <CatalogCoveragePills provider={provider} className="mt-3" />
        <CatalogTrustPills provider={provider} className="mt-2" />
        {provider.status_reason && (
          <div className="mt-2 text-[11px] leading-5 text-[var(--foreground-dim)]">
            {provider.status_reason}
          </div>
        )}
        {provider.replacement_provider_id && (
          <div className="mt-1 text-[11px] font-semibold text-[var(--foreground-dim)]">
            {t("catalogPage.detail.replacement", {
              provider: provider.replacement_provider_id,
            })}
          </div>
        )}
      </div>

      <div className="space-y-4 px-4 py-4">
        <DetailSection title={t("catalogPage.detail.catalogTruth")}>
          <div className="grid gap-2 sm:grid-cols-2">
            <KeyValue
              label={t("catalogPage.detail.providerStatus")}
              value={t(`catalogPage.providerStatus.${providerStatus}`, {
                defaultValue: providerStatus,
              })}
            />
            <KeyValue
              label={t("catalogPage.detail.defaultVisibility")}
              value={t(
                provider.default_visible
                  ? "catalogPage.detail.defaultVisible"
                  : "catalogPage.detail.legacyHidden",
              )}
            />
            <KeyValue
              label={t("catalogPage.detail.canonicalCoverage")}
              value={t("catalogSignals.canonicalCoverage", {
                mapped:
                  provider.canonical_model_coverage?.canonicalized_models ?? 0,
                total:
                  provider.canonical_model_coverage?.total_models ??
                  provider.models.length,
              })}
            />
            <KeyValue
              label={t("catalogPage.detail.pricingCoverage")}
              value={t("catalogSignals.pricingCoverage", {
                priced: provider.pricing_coverage?.priced_models ?? 0,
                total:
                  provider.pricing_coverage?.total_models ??
                  provider.models.length,
              })}
            />
          </div>
          <p className="mt-2 text-[10px] leading-4 text-[var(--foreground-dim)]">
            {t("catalogPage.detail.catalogTruthCopy")}
          </p>
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.links")}>
          <div className="flex flex-wrap gap-2">
            <CatalogLink
              href={provider.homepage_url}
              label={t("catalogPage.detail.homepage")}
            />
            <CatalogLink
              href={provider.docs_url}
              label={t("catalogPage.detail.docs")}
            />
            <CatalogLink
              href={provider.pricing_url || provider.pricing?.source_url}
              label={t("catalogPage.detail.pricing")}
            />
          </div>
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.connection")}>
          <KeyValue
            label={t("catalogPage.detail.authType")}
            value={provider.auth_type}
          />
          <KeyValue
            label={t("catalogPage.detail.compatibility")}
            value={t(
              `catalogPage.compatibility.${providerCompatibility(provider)}`,
              { defaultValue: providerCompatibility(provider) },
            )}
          />
          <KeyValue
            label={t("catalogPage.detail.baseUrl")}
            value={provider.base_url}
            mono
          />
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.endpoints")}>
          <div className="grid gap-2">
            {endpoints.length === 0 ? (
              <span className="text-[11px] text-[var(--foreground-dim)]">
                {t("catalogPage.detail.noEndpoints")}
              </span>
            ) : (
              endpoints.map(([key, value]) => (
                <KeyValue key={key} label={key} value={value || "-"} mono />
              ))
            )}
          </div>
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.modelBuckets")}>
          <div className="grid gap-2">
            {MODEL_BUCKET_LABELS.map((bucket) => {
              const values = buckets[bucket] || [];
              if (values.length === 0) return null;
              return (
                <div key={bucket}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    {t(`catalogPage.buckets.${bucket}`)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {values.slice(0, 5).map((model) => (
                      <Badge
                        key={model}
                        variant="zinc"
                        className="max-w-[180px] truncate font-mono text-[9px]"
                      >
                        {model}
                      </Badge>
                    ))}
                    {values.length > 5 && (
                      <Badge variant="zinc" className="text-[9px]">
                        +{values.length - 5}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.freshDefaults")}>
          <p className="mb-2 text-[11px] leading-5 text-[var(--foreground-dim)]">
            {t("catalogPage.detail.freshDefaultsDescription")}
          </p>
          {recommendedModels.length === 0 ? (
            <span className="text-[11px] text-[var(--foreground-dim)]">
              {t("catalogPage.detail.noEnrichment")}
            </span>
          ) : (
            <div className="space-y-2">
              {recommendedModels
                .slice(0, 6)
                .map(({ model, buckets: modelBuckets }) => {
                  const benchmarks = topBenchmarkSnippets(model);
                  return (
                    <div
                      key={model.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-extrabold text-[var(--foreground)]">
                            {model.display_name || model.name || model.id}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--foreground-dim)]">
                            {model.id}
                          </div>
                        </div>
                        <Badge
                          variant="blue"
                          className="shrink-0 whitespace-nowrap"
                        >
                          {t("catalogPage.badges.recommendedDefault")}
                        </Badge>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {modelBuckets.slice(0, 3).map((bucket) => (
                          <Badge
                            key={bucket}
                            variant="zinc"
                            className="text-[9px]"
                          >
                            {t(`catalogPage.buckets.${bucket}`)}
                          </Badge>
                        ))}
                        {model.pricing?.manual_review_required && (
                          <Badge variant="amber" className="text-[9px]">
                            {t("catalogPage.badges.review")}
                          </Badge>
                        )}
                        {model.match_confidence === "low" && (
                          <Badge variant="amber" className="text-[9px]">
                            {t("catalogSignals.lowConfidence", { count: 1 })}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <KeyValue
                          label={t("catalogPage.detail.releaseDate")}
                          value={modelReleaseDate(model)}
                        />
                        <KeyValue
                          label={t("catalogPage.detail.context")}
                          value={
                            model.limits?.max_context_tokens
                              ? model.limits.max_context_tokens.toLocaleString()
                              : "-"
                          }
                        />
                        <KeyValue
                          label={t("catalogPage.detail.throughput")}
                          value={
                            modelThroughput(model)
                              ? t("catalogPage.detail.throughputValue", {
                                  value: formatCompactNumber(
                                    modelThroughput(model),
                                  ),
                                })
                              : "-"
                          }
                        />
                      </div>

                      {benchmarks.length > 0 && (
                        <div className="mt-3">
                          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                            {t("catalogPage.detail.topBenchmarks")}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {benchmarks.map((entry) => (
                              <Badge
                                key={entry.key}
                                variant="zinc"
                                className="text-[9px]"
                              >
                                {entry.label} {entry.value}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.capabilities")}>
          <div className="flex flex-wrap gap-1">
            {capabilities.length === 0 ? (
              <span className="text-[11px] text-[var(--foreground-dim)]">
                {t("catalogPage.detail.noCapabilities")}
              </span>
            ) : (
              capabilities.slice(0, 12).map((capability) => (
                <Badge key={capability} variant="zinc" className="text-[9px]">
                  {capability}
                </Badge>
              ))
            )}
            {capabilities.length > 12 && (
              <Badge variant="zinc" className="text-[9px]">
                +{capabilities.length - 12}
              </Badge>
            )}
          </div>
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.limits")}>
          <KeyValue
            label={t("catalogPage.detail.modelCount")}
            value={String(
              provider.limits?.model_count ?? provider.models.length,
            )}
          />
          <KeyValue
            label={t("catalogPage.detail.context")}
            value={
              provider.limits?.max_context_tokens
                ? provider.limits.max_context_tokens.toLocaleString()
                : "-"
            }
          />
          <KeyValue
            label={t("catalogPage.detail.fileSize")}
            value={formatBytes(provider.limits?.max_file_size)}
          />
        </DetailSection>

        <DetailSection title={t("catalogPage.detail.pricingUnits")}>
          <div className="grid gap-2">
            {Object.keys(pricingUnits).length === 0 ? (
              <span className="text-[11px] text-[var(--foreground-dim)]">
                {t("catalogPage.detail.noPricing")}
              </span>
            ) : (
              Object.entries(pricingUnits).map(([key, value]) => (
                <KeyValue
                  key={key}
                  label={key}
                  value={friendlyUnit(value ?? "-")}
                />
              ))
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={sourceVariant(provider.pricing?.source)}>
              {t(
                `catalogPage.sources.${sourceLabel(provider.pricing?.source)}`,
                {
                  source: provider.pricing?.source || "-",
                  defaultValue: provider.pricing?.source || "-",
                },
              )}
            </Badge>
            <Badge variant="zinc">
              {t("catalogPage.confidence", {
                confidence: t(
                  `catalogPage.confidenceLevels.${provider.pricing?.pricing_confidence || "unknown"}`,
                ),
              })}
            </Badge>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-[var(--foreground-dim)]">
            {t("catalogPage.detail.pricingReferenceCopy")}
          </p>
        </DetailSection>

        {sync && (
          <DetailSection title={t("catalogPage.detail.syncStatus")}>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={syncStatusVariant(sync.status)}>
                {t(`catalogPage.sync.status.${sync.status}`)}
              </Badge>
              {sync.automatic && (
                <Badge variant="emerald">
                  {t("catalogPage.refreshSources.automatic")}
                </Badge>
              )}
              {sync.stale && (
                <Badge variant="amber">{t("catalogPage.status.stale")}</Badge>
              )}
            </div>
            <KeyValue
              label={t("catalogPage.sync.lastSyncLabel")}
              value={sync.last_sync || t("catalogPage.sync.never")}
            />
          </DetailSection>
        )}
      </div>
    </aside>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
        {title}
      </div>
      {children}
    </section>
  );
}

function KeyValue({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-[var(--background)] px-2.5 py-2">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--foreground-dim)]">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-[11px] font-semibold text-[var(--foreground-muted)]",
          mono && "font-mono",
        )}
      >
        {value || "-"}
      </span>
    </div>
  );
}

function CatalogLink({ href, label }: { href?: string | null; label: string }) {
  if (!href) {
    return <Badge variant="zinc">{label}: -</Badge>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--foreground-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function CatalogSyncStatusCard({ status }: { status: CatalogSyncStatus }) {
  const { t } = useTranslation("nodes");
  const openRouter = status.providers.find(
    (provider) => provider.provider === "openrouter",
  );
  const enabledCount = status.enabled_adapters.length;
  const failedCount = status.providers.filter(
    (provider) => provider.status === "failed",
  ).length;
  const staleCount = status.providers.filter(
    (provider) => provider.stale,
  ).length;
  const visibleProviders = status.providers
    .filter(
      (provider) =>
        provider.enabled || provider.supported || provider.status === "failed",
    )
    .slice(0, 4);

  return (
    <Card>
      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>{t("catalogPage.sync.title")}</CardTitle>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--foreground-dim)]">
            {t("catalogPage.sync.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 md:justify-end">
          <Badge variant={status.scheduled ? "emerald" : "zinc"}>
            {status.scheduled
              ? t("catalogPage.sync.scheduled")
              : t("catalogPage.sync.disabled")}
          </Badge>
          <Badge variant={status.write_to === "cache" ? "blue" : "amber"}>
            {t(`catalogPage.sync.writeTargets.${status.write_to}`)}
          </Badge>
          {failedCount > 0 && (
            <Badge variant="red">
              {t("catalogPage.sync.failedCount", { count: failedCount })}
            </Badge>
          )}
          {staleCount > 0 && (
            <Badge variant="amber">
              {t("catalogPage.sync.staleCount", { count: staleCount })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="rounded-lg bg-[var(--background-secondary)] p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <SyncFact
                label={t("catalogPage.sync.enabledAdapters")}
                value={String(enabledCount)}
              />
              <SyncFact
                label={t("catalogPage.sync.interval")}
                value={t("catalogPage.sync.intervalValue", {
                  count: status.interval_minutes,
                })}
              />
              <SyncFact
                label={t("catalogPage.sync.lastOpenRouter")}
                value={openRouter?.last_sync || t("catalogPage.sync.never")}
              />
            </div>
            <div className="mt-3 grid gap-2 text-[11px] text-[var(--foreground-dim)]">
              <div className="truncate">
                <span className="font-bold text-[var(--foreground-muted)]">
                  {t("catalogPage.sync.cacheFile")}:{" "}
                </span>
                <span className="font-mono">{status.cache_file}</span>
              </div>
              <div className="truncate">
                <span className="font-bold text-[var(--foreground-muted)]">
                  {t("catalogPage.sync.overrideFile")}:{" "}
                </span>
                <span className="font-mono">{status.override_file}</span>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleProviders.map((provider) => (
              <div
                key={provider.provider}
                className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-extrabold text-[var(--foreground)]">
                      {provider.label}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--foreground-dim)]">
                      {provider.provider}
                    </div>
                  </div>
                  <Badge
                    variant={syncStatusVariant(provider.status)}
                    className="shrink-0 whitespace-nowrap"
                  >
                    {t(`catalogPage.sync.status.${provider.status}`)}
                  </Badge>
                </div>
                <div className="mt-2 text-[10px] leading-4 text-[var(--foreground-dim)]">
                  {provider.last_sync
                    ? t("catalogPage.sync.lastSyncValue", {
                        value: provider.last_sync,
                      })
                    : t("catalogPage.sync.neverSynced")}
                </div>
                {provider.last_error && (
                  <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-red-500">
                    {provider.last_error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SyncFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[12px] font-semibold text-[var(--foreground)]">
        {value}
      </div>
    </div>
  );
}

function CatalogMetric({
  label,
  value,
  icon: Icon,
  tone = "zinc",
}: {
  label: string;
  value: number;
  icon: typeof Boxes;
  tone?: "zinc" | "amber" | "emerald";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 pt-5">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
            {label}
          </div>
          <div className="mt-2 text-2xl font-extrabold text-[var(--foreground)]">
            {value}
          </div>
        </div>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            tone === "amber"
              ? "bg-amber-500/10 text-amber-600"
              : tone === "emerald"
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-[var(--background-tertiary)] text-[var(--foreground-muted)]",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function CatalogRefreshSources({
  sources,
}: {
  sources: NonNullable<CatalogProvidersResponse["refresh_sources"]>;
}) {
  const { t } = useTranslation("nodes");
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;

  const pinnedProviders = new Set(["openrouter", "local-override"]);
  const sortedSources = [...sources].sort((a, b) => {
    const pinnedA = pinnedProviders.has(a.provider) || a.automatic;
    const pinnedB = pinnedProviders.has(b.provider) || b.automatic;
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  const collapsedCount = 4;
  const visibleSources = expanded
    ? sortedSources
    : sortedSources.slice(0, collapsedCount);
  const hiddenCount = Math.max(0, sortedSources.length - visibleSources.length);
  const automaticCount = sources.filter((source) => source.automatic).length;
  const docsReviewCount = sources.filter(
    (source) => source.mode === "docs_review",
  ).length;
  const localCount = sources.filter(
    (source) => source.mode === "operator_local",
  ).length;

  return (
    <Card>
      <CardHeader className="gap-3 pb-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle>{t("catalogPage.refreshSources.title")}</CardTitle>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--foreground-dim)]">
            {t("catalogPage.refreshSources.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          <Badge variant="emerald" className="whitespace-nowrap">
            {automaticCount} {t("catalogPage.refreshSources.automatic")}
          </Badge>
          <Badge variant="blue" className="whitespace-nowrap">
            {docsReviewCount}{" "}
            {t("catalogPage.refreshSources.modes.docs_review")}
          </Badge>
          <Badge variant="amber" className="whitespace-nowrap">
            {localCount} {t("catalogPage.refreshSources.modes.operator_local")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {visibleSources.map((source) => (
            <div
              key={source.provider}
              className="rounded-lg border border-[var(--border)] bg-[var(--background-secondary)] px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-extrabold text-[var(--foreground)]">
                    {source.label}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--foreground-dim)]">
                    {source.provider}
                  </div>
                </div>
                <Badge
                  variant={refreshSourceVariant(source)}
                  className="shrink-0 whitespace-nowrap"
                >
                  {source.automatic
                    ? t("catalogPage.refreshSources.automatic")
                    : t(`catalogPage.refreshSources.modes.${source.mode}`)}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-[11px] leading-5 text-[var(--foreground-dim)]">
                {source.notes}
              </p>
              {source.source_url && (
                <a
                  href={source.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent)]"
                >
                  {t("catalogPage.refreshSources.sourceLink")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
        {sources.length > collapsedCount && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-[11px] font-medium text-[var(--foreground-dim)]">
              {t("catalogPage.refreshSources.summary", {
                shown: visibleSources.length,
                total: sources.length,
              })}
              {hiddenCount > 0 ? ` · +${hiddenCount}` : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {expanded
                ? t("catalogPage.refreshSources.showLess")
                : t("catalogPage.refreshSources.showAll", {
                    count: sources.length,
                  })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
