import {
  INNOVATEATS_WEBSITE,
  countMessageWords,
  messageBriefSchema,
  messageDraftContentSchema,
  messageQaReviewSchema,
  messageSequenceSchema,
  type MateoCredentialKey,
  type MessageBrief,
  type MessageDraftContent,
  type MessageEvidenceMapItem,
  type MessageQaReview,
  type MessageSequence
} from "@innovateats/shared";

const credentialCopy: Readonly<Record<MateoCredentialKey, Readonly<Record<"en" | "es", string>>>> =
  {
    chef_rd: {
      en: "a former professional chef with food product development and R&D experience",
      es: "exchef profesional con experiencia en desarrollo de producto alimentario e I+D"
    },
    ecommerce_operator: {
      en: "an ecommerce operator",
      es: "operador de ecommerce"
    },
    paid_media_200k: {
      en: "an operator who has invested over EUR 200,000 of his own capital in paid acquisition",
      es: "operador que ha invertido mas de 200.000 EUR de capital propio en adquisicion de pago"
    },
    integrated_operator: {
      en: "an operator who connects product, positioning, and ecommerce",
      es: "operador que conecta producto, posicionamiento y ecommerce"
    },
    external_specialist_coordination: {
      en: "an operator experienced in coordinating specialist partners",
      es: "operador con experiencia coordinando especialistas externos"
    }
  };

const allowedCredentialsByOpportunity = {
  product: ["chef_rd", "integrated_operator"],
  ecommerce: ["ecommerce_operator", "paid_media_200k", "integrated_operator"],
  integrated: ["chef_rd", "ecommerce_operator", "integrated_operator"],
  cultural: ["chef_rd"],
  paid_launch: ["paid_media_200k", "ecommerce_operator"]
} as const satisfies Readonly<
  Record<MessageBrief["opportunityType"], readonly MateoCredentialKey[]>
>;

const prohibitedMessagePatterns = [
  /\b10x\b/iu,
  /\bguarantee(?:d)?\b/iu,
  /\bmillions?\b/iu,
  /\bterrible\b/iu,
  /\burgent\b/iu,
  /\bleaving money on the table\b/iu
] as const;

function concise(value: string, maximumWords: number): string {
  return value.trim().replace(/\s+/gu, " ").split(" ").slice(0, maximumWords).join(" ");
}

function assertCredentialFit(brief: MessageBrief): void {
  const allowed = new Set<MateoCredentialKey>(
    allowedCredentialsByOpportunity[brief.opportunityType]
  );
  const invalid = brief.selectedCredentials.filter((credential) => !allowed.has(credential));
  if (invalid.length > 0) {
    throw new Error(
      `Credentials ${invalid.join(", ")} do not support opportunity type ${brief.opportunityType}.`
    );
  }
}

function credentialsSentence(brief: MessageBrief): string {
  const descriptions = brief.selectedCredentials.map(
    (credential) => credentialCopy[credential][brief.language]
  );
  return brief.language === "es"
    ? `Soy Mateo, ${descriptions.join(" y ")}.`
    : `I'm Mateo, ${descriptions.join(" and ")}.`;
}

function subjectForBrand(brandName: string, language: "en" | "es"): string {
  const brandWords = concise(brandName, 4);
  return language === "es" ? `Una idea sobre ${brandWords}` : `A thought on ${brandWords}`;
}

function createDraft(
  sequenceStep: 1 | 2 | 3,
  subject: string | null,
  bodyParts: readonly string[],
  language: "en" | "es",
  personalizationTokens: readonly string[],
  evidenceMap: readonly MessageEvidenceMapItem[]
): MessageDraftContent {
  const body = bodyParts.join("\n\n");
  return messageDraftContentSchema.parse({
    channel: "email",
    sequenceStep,
    subject,
    body,
    language,
    personalizationTokens,
    evidenceMap,
    wordCount: countMessageWords(body)
  });
}

export function buildMessageSequence(rawBrief: MessageBrief): MessageSequence {
  const brief = messageBriefSchema.parse(rawBrief);
  assertCredentialFit(brief);

  const brand = concise(brief.brandName, 4);
  const product = concise(brief.productDescription, 12);
  const discovery = concise(brief.discoveryFact, 18);
  const opportunity = concise(brief.specificOpportunity, 12);
  const nextStep = concise(brief.nextExecutionStep, 8);
  const greeting =
    brief.language === "es"
      ? `Hola${brief.contactFirstName === null ? "" : ` ${brief.contactFirstName}`},`
      : `Hi${brief.contactFirstName === null ? " there" : ` ${brief.contactFirstName}`},`;
  const credential = credentialsSentence(brief);
  const website = `InnovatEats: ${INNOVATEATS_WEBSITE}`;

  const initial =
    brief.language === "es"
      ? (() => {
          const fact = `He conocido ${brand} a traves de ${product}. ${discovery}`;
          const opportunitySentence = `Creo que la oportunidad mas fuerte podria ser ${opportunity}.`;
          const timing = `Antes de ${nextStep}, aclarar esa decision podria hacer que el valor del producto se entienda mas rapido y dar al lanzamiento un camino mas coherente.`;
          const offer =
            "Por eso construi InnovatEats para conectar producto, posicionamiento y ecommerce, en vez de tratar cada decision por separado.";
          const cta =
            "¿Te abririas a una llamada gratuita de 25 minutos? Me gustaria conocer mejor lo que estas construyendo y ver si hay algo util en lo que InnovatEats pueda ayudar.";
          return createDraft(
            1,
            subjectForBrand(brand, "es"),
            [greeting, fact, opportunitySentence, timing, credential, offer, cta, website],
            "es",
            [brand, product, opportunity],
            [
              { textSpan: fact, kind: "fact", evidenceIds: brief.evidenceIds },
              { textSpan: opportunitySentence, kind: "inference", evidenceIds: [] },
              { textSpan: timing, kind: "inference", evidenceIds: [] },
              { textSpan: credential, kind: "credential", evidenceIds: [] },
              { textSpan: offer, kind: "offer", evidenceIds: [] },
              { textSpan: cta, kind: "cta", evidenceIds: [] },
              { textSpan: website, kind: "offer", evidenceIds: [] }
            ]
          );
        })()
      : (() => {
          const fact = `I came across ${brand} through ${product}. ${discovery}`;
          const opportunitySentence = `I think the strongest opportunity may be ${opportunity}.`;
          const timing = `Before ${nextStep}, clarifying that choice could make the product's value easier to understand and give the launch a more coherent path.`;
          const offer =
            "That is why I built InnovatEats to connect product, positioning, and ecommerce decisions instead of treating them separately.";
          const cta =
            "Would you be open to a free 25-minute call? I'd like to learn more about what you're building and see whether there is anything useful InnovatEats could help with.";
          return createDraft(
            1,
            subjectForBrand(brand, "en"),
            [greeting, fact, opportunitySentence, timing, credential, offer, cta, website],
            "en",
            [brand, product, opportunity],
            [
              { textSpan: fact, kind: "fact", evidenceIds: brief.evidenceIds },
              { textSpan: opportunitySentence, kind: "inference", evidenceIds: [] },
              { textSpan: timing, kind: "inference", evidenceIds: [] },
              { textSpan: credential, kind: "credential", evidenceIds: [] },
              { textSpan: offer, kind: "offer", evidenceIds: [] },
              { textSpan: cta, kind: "cta", evidenceIds: [] },
              { textSpan: website, kind: "offer", evidenceIds: [] }
            ]
          );
        })();

  const followUpOne =
    brief.language === "es"
      ? (() => {
          const fact = `He vuelto a mirar ${product}.`;
          const insight = `Puede que todavia merezca la pena explorar ${opportunity}.`;
          const timing = `Resolverlo antes de ${nextStep} podria reducir decisiones costosas mas adelante.`;
          const cta =
            "Si te resulta util, puedo compartir como probaria esa decision en una llamada breve y gratuita.";
          return createDraft(
            2,
            null,
            [fact, insight, timing, cta, website],
            "es",
            [product, opportunity],
            [
              { textSpan: fact, kind: "fact", evidenceIds: brief.evidenceIds },
              { textSpan: insight, kind: "inference", evidenceIds: [] },
              { textSpan: timing, kind: "inference", evidenceIds: [] },
              { textSpan: cta, kind: "cta", evidenceIds: [] },
              { textSpan: website, kind: "offer", evidenceIds: [] }
            ]
          );
        })()
      : (() => {
          const fact = `I took another look at ${product}.`;
          const insight = `There may still be room to explore ${opportunity}.`;
          const timing = `Resolving it before ${nextStep} could reduce costly decisions later.`;
          const cta =
            "If useful, I can share how I would test that decision in a short, free call.";
          return createDraft(
            2,
            null,
            [fact, insight, timing, cta, website],
            "en",
            [product, opportunity],
            [
              { textSpan: fact, kind: "fact", evidenceIds: brief.evidenceIds },
              { textSpan: insight, kind: "inference", evidenceIds: [] },
              { textSpan: timing, kind: "inference", evidenceIds: [] },
              { textSpan: cta, kind: "cta", evidenceIds: [] },
              { textSpan: website, kind: "offer", evidenceIds: [] }
            ]
          );
        })();

  const followUpTwo =
    brief.language === "es"
      ? (() => {
          const close = `Cierro el hilo sobre ${brand}. Sigo pensando que ${opportunity} podria merecer una conversacion.`;
          const cta =
            "Si encaja mas adelante, estare encantado de tener la llamada gratuita. Si no es relevante, no hace falta responder y no volvere a escribir.";
          return createDraft(
            3,
            null,
            [close, cta, website],
            "es",
            [brand, opportunity],
            [
              { textSpan: close, kind: "inference", evidenceIds: [] },
              { textSpan: cta, kind: "cta", evidenceIds: [] },
              { textSpan: website, kind: "offer", evidenceIds: [] }
            ]
          );
        })()
      : (() => {
          const close = `I'll close the loop on ${brand}. I still think ${opportunity} may be worth a conversation.`;
          const cta =
            "If the timing becomes relevant, I'd be happy to have the free call. If not, no reply is needed and I will not write again.";
          return createDraft(
            3,
            null,
            [close, cta, website],
            "en",
            [brand, opportunity],
            [
              { textSpan: close, kind: "inference", evidenceIds: [] },
              { textSpan: cta, kind: "cta", evidenceIds: [] },
              { textSpan: website, kind: "offer", evidenceIds: [] }
            ]
          );
        })();

  return messageSequenceSchema.parse({ drafts: [initial, followUpOne, followUpTwo] });
}

export function reviewMessageDraft(
  rawDraft: MessageDraftContent,
  allowedEvidenceIds: readonly string[]
): MessageQaReview {
  const draft = messageDraftContentSchema.parse(rawDraft);
  const allowed = new Set(allowedEvidenceIds);
  const unsupportedClaims = draft.evidenceMap
    .filter(
      (item) =>
        item.kind === "fact" &&
        (item.evidenceIds.length === 0 ||
          item.evidenceIds.some((evidenceId) => !allowed.has(evidenceId)))
    )
    .map((item) => item.textSpan);
  const prohibited = prohibitedMessagePatterns
    .filter((pattern) => pattern.test(`${draft.subject ?? ""} ${draft.body}`))
    .map((pattern) => `Prohibited language matched ${pattern.source}.`);
  const hasSpecificity = draft.personalizationTokens.every((token) =>
    draft.body.toLowerCase().includes(token.toLowerCase())
  );
  const hasOneCta =
    draft.sequenceStep === 1
      ? (draft.body.match(/\?/gu) ?? []).length === 1
      : /\b(?:call|llamada)\b/iu.test(draft.body);
  const hasWebsite = draft.body.includes(INNOVATEATS_WEBSITE);
  const requiredRevisions = [
    ...prohibited,
    ...(hasSpecificity ? [] : ["Every personalization token must occur in the message."]),
    ...(hasOneCta ? [] : ["The message must contain one clear call CTA."]),
    ...(hasWebsite ? [] : [`The message must contain ${INNOVATEATS_WEBSITE}.`])
  ];

  return messageQaReviewSchema.parse({
    passed: unsupportedClaims.length === 0 && requiredRevisions.length === 0,
    factualityScore: unsupportedClaims.length === 0 ? 100 : 0,
    specificityScore: hasSpecificity ? 100 : 40,
    salesQualityScore: requiredRevisions.length === 0 ? 100 : 50,
    unsupportedClaims,
    requiredRevisions
  });
}

export function remapHumanEditEvidence(
  previous: MessageDraftContent,
  editedBody: string
): MessageEvidenceMapItem[] {
  const previousDraft = messageDraftContentSchema.parse(previous);
  const previousParagraphs = previousDraft.body.split(/\n{2,}/u);
  const editedParagraphs = editedBody.trim().split(/\n{2,}/u);
  if (previousParagraphs.length !== editedParagraphs.length) {
    throw new Error("Human edits must preserve the reviewed paragraph structure.");
  }

  return previousDraft.evidenceMap.map((item) => {
    const paragraphIndex = previousParagraphs.findIndex((paragraph) => paragraph === item.textSpan);
    if (paragraphIndex === -1) {
      throw new Error("The previous evidence map is not aligned to message paragraphs.");
    }
    const editedText = editedParagraphs[paragraphIndex];
    if (editedText === undefined || editedText.trim() === "") {
      throw new Error("A reviewed message paragraph cannot be removed.");
    }
    if (item.kind === "fact" && editedText !== item.textSpan) {
      throw new Error(
        "Evidence-backed factual paragraphs cannot be edited without a new evidence review."
      );
    }
    return { ...item, textSpan: editedText };
  });
}
