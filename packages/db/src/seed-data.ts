import { defaultFeatureFlags, type FeatureFlagKey } from "@innovateats/shared";

import type { AppDatabase } from "./client.js";
import {
  evidence,
  featureFlags,
  leads,
  leadStatusHistory,
  organizations,
  regions,
  sourceDocuments,
  sources,
  systemSettings
} from "./schema/index.js";

const descriptions: Readonly<Record<FeatureFlagKey, string>> = {
  global_dry_run: "Prevent all real external actions.",
  research_enabled: "Allow scheduled public-source research.",
  contact_enrichment_enabled: "Allow contact discovery and verification adapters.",
  message_generation_enabled: "Allow message generation workflows.",
  email_send_enabled: "Allow the email adapter to execute after every other gate.",
  autonomous_send_enabled: "Allow approved allowlisted autonomous email.",
  inbound_processing_enabled: "Allow Gmail inbound reply processing.",
  social_manual_queue_enabled: "Allow generation of manual social-platform drafts."
};

const regionSeeds = [
  ["US", "United States", "en", "approval_required"],
  ["UK", "United Kingdom", "en", "approval_required"],
  ["ES", "Spain", "es", "draft_only"],
  ["CENTRAL_EU", "Central Europe", "en", "draft_only"],
  ["AU_NZ", "Australia and New Zealand", "en", "draft_only"],
  ["ASIA", "Asia (country adapter required)", "en", "draft_only"]
] as const;

const crmSeed = [
  {
    organizationId: "10000000-0000-4000-8000-000000000001",
    leadId: "20000000-0000-4000-8000-000000000001",
    documentId: "30000000-0000-4000-8000-000000000001",
    evidenceId: "40000000-0000-4000-8000-000000000001",
    brand: "Northstar Gummies — sample",
    domain: "northstar-gummies.seed.innovateats.com",
    country: "United States",
    regionCode: "US",
    stage: "crowdfunding",
    product: "A sample single-SKU functional gummy created for CRM acceptance testing.",
    signal: "Sample crowdfunding launch signal; not a real company claim.",
    score: 88,
    status: "scored",
    url: "https://innovateats.com/crm-seed/northstar-gummies"
  },
  {
    organizationId: "10000000-0000-4000-8000-000000000002",
    leadId: "20000000-0000-4000-8000-000000000002",
    documentId: "30000000-0000-4000-8000-000000000002",
    evidenceId: "40000000-0000-4000-8000-000000000002",
    brand: "Luma Chews — sample",
    domain: "luma-chews.seed.innovateats.com",
    country: "Spain",
    regionCode: "ES",
    stage: "prelaunch",
    product: "A sample narrow-category chew concept created for CRM acceptance testing.",
    signal: "Sample prelaunch waitlist signal; not a real company claim.",
    score: 82,
    status: "researched",
    url: "https://innovateats.com/crm-seed/luma-chews"
  },
  {
    organizationId: "10000000-0000-4000-8000-000000000003",
    leadId: "20000000-0000-4000-8000-000000000003",
    documentId: "30000000-0000-4000-8000-000000000003",
    evidenceId: "40000000-0000-4000-8000-000000000003",
    brand: "Cultiva Bar — sample",
    domain: "cultiva-bar.seed.innovateats.com",
    country: "United Kingdom",
    regionCode: "UK",
    stage: "first_sales",
    product: "A sample hero-product bar brand created for CRM acceptance testing.",
    signal: "Sample first-sales signal; not a real company claim.",
    score: 74,
    status: "entity_resolved",
    url: "https://innovateats.com/crm-seed/cultiva-bar"
  }
] as const;

export async function seedFoundations(database: AppDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    for (const [key, enabled] of Object.entries(defaultFeatureFlags) as [
      FeatureFlagKey,
      boolean
    ][]) {
      await transaction
        .insert(featureFlags)
        .values({
          key,
          enabled,
          description: descriptions[key],
          riskTier: key === "global_dry_run" ? "critical" : "high",
          updatedBy: "phase-0-seed"
        })
        .onConflictDoNothing();
    }

    for (const [code, name, defaultLanguage, policyMode] of regionSeeds) {
      await transaction
        .insert(regions)
        .values({
          code,
          name,
          defaultLanguage,
          policyMode,
          enabled: false
        })
        .onConflictDoNothing();
    }

    await transaction
      .insert(systemSettings)
      .values({
        key: "required_outreach_website",
        value: "https://innovateats.com",
        updatedBy: "phase-0-seed"
      })
      .onConflictDoNothing();

    await transaction
      .insert(systemSettings)
      .values({
        key: "authorized_email",
        value: "maateosanchezt@gmail.com",
        sensitive: true,
        updatedBy: "phase-0-seed"
      })
      .onConflictDoNothing();

    const [seedSource] = await transaction
      .insert(sources)
      .values({
        id: "50000000-0000-4000-8000-000000000001",
        type: "seed",
        name: "Phase 1 acceptance fixtures",
        baseUrl: "https://innovateats.com/",
        termsStatus: "allowed",
        robotsStatus: "allowed",
        config: { synthetic: true }
      })
      .onConflictDoUpdate({
        target: [sources.type, sources.name],
        set: { updatedAt: new Date() }
      })
      .returning({ id: sources.id });

    if (seedSource === undefined) {
      throw new Error("CRM seed source could not be resolved.");
    }

    const regionRows = await transaction
      .select({ id: regions.id, code: regions.code })
      .from(regions);
    const regionByCode = new Map(regionRows.map((region) => [region.code, region.id]));

    for (const item of crmSeed) {
      await transaction
        .insert(sourceDocuments)
        .values({
          id: item.documentId,
          sourceId: seedSource.id,
          url: item.url,
          canonicalUrl: item.url,
          title: item.brand,
          extractedText: item.product,
          trustLevel: "user_provided",
          metadata: { synthetic: true }
        })
        .onConflictDoNothing();

      await transaction
        .insert(organizations)
        .values({
          id: item.organizationId,
          normalizedName: item.brand.toLowerCase(),
          displayName: item.brand,
          canonicalDomain: item.domain,
          country: item.country,
          stage: item.stage,
          productSummary: item.product,
          ...(regionByCode.get(item.regionCode) === undefined
            ? {}
            : { regionId: regionByCode.get(item.regionCode) })
        })
        .onConflictDoNothing();

      const insertedLead = await transaction
        .insert(leads)
        .values({
          id: item.leadId,
          organizationId: item.organizationId,
          status: item.status,
          icpScore: item.score,
          scoreConfidence: 0.75,
          discoverySignal: item.signal,
          currentOwner: "maateosanchezt@gmail.com"
        })
        .onConflictDoNothing()
        .returning({ id: leads.id });

      if (insertedLead.length > 0) {
        await transaction.insert(evidence).values({
          id: item.evidenceId,
          leadId: item.leadId,
          sourceDocumentId: item.documentId,
          factType: "seed_fixture",
          claim: item.signal,
          quoteOrSummary: item.product,
          sourceUrl: item.url,
          observedAt: new Date("2026-07-19T00:00:00.000Z"),
          confidence: 1,
          isInference: false,
          createdBy: "phase-1-seed"
        });

        await transaction.insert(leadStatusHistory).values({
          leadId: item.leadId,
          fromStatus: null,
          toStatus: item.status,
          reason: "Synthetic acceptance fixture",
          actorId: "phase-1-seed"
        });
      }
    }
  });
}
