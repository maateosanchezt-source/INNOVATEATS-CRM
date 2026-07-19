import {
  replyClassificationSchema,
  type InboundMessage,
  type ReplyClassification
} from "@innovateats/shared";

const spanishMonths: Readonly<Record<string, number>> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12
};

function snippet(body: string, pattern: RegExp): string[] {
  const match = body.match(pattern);
  return match?.[0] === undefined ? [] : [match[0].slice(0, 500)];
}

export function extractVisibleReply(body: string): string {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const visible: string[] = [];
  for (const line of lines) {
    if (/^\s*>/u.test(line)) {
      continue;
    }
    if (/^\s*On .+wrote:\s*$/iu.test(line) || /^\s*El .+escribi[oó]:\s*$/iu.test(line)) {
      break;
    }
    if (/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/iu.test(line)) {
      break;
    }
    visible.push(line);
  }
  return visible.join("\n").trim().slice(0, 50_000);
}

function validDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate.toISOString().slice(0, 10);
}

export function extractFollowUpDate(body: string): string | null {
  const iso = body.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/u);
  if (iso !== null) {
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const spanish = body
    .toLowerCase()
    .match(
      /\b(?:hasta\s+(?:el\s+)?)?([0-2]?\d|3[01])\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(20\d{2}))?\b/u
    );
  if (spanish !== null && spanish[2] !== undefined) {
    return validDate(
      Number(spanish[3] ?? new Date().getUTCFullYear()),
      spanishMonths[spanish[2]] ?? 0,
      Number(spanish[1])
    );
  }
  const english = body.match(
    /\b(?:until\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-2]?\d|3[01])(?:,\s*(20\d{2}))?\b/iu
  );
  if (english !== null && english[1] !== undefined) {
    const parsed = Date.parse(
      `${english[1]} ${english[2] ?? "1"}, ${english[3] ?? new Date().getUTCFullYear()} UTC`
    );
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  }
  return null;
}

function result(
  classification: ReplyClassification["classification"],
  confidence: number,
  sentiment: ReplyClassification["sentiment"],
  requestedAction: ReplyClassification["requestedAction"],
  suppressionRequired: boolean,
  evidenceSnippets: readonly string[],
  followUpDate: string | null = null
): ReplyClassification {
  return replyClassificationSchema.parse({
    classification,
    confidence,
    sentiment,
    requestedAction,
    suppressionRequired,
    followUpDate,
    evidenceSnippets: [...evidenceSnippets]
  });
}

export function classifyReply(message: InboundMessage): ReplyClassification {
  const body = extractVisibleReply(message.bodyText);
  const searchable = `${message.fromAddress}\n${message.subject}\n${body}`.toLowerCase();
  const autoSubmitted = message.headers["auto-submitted"]?.toLowerCase();

  const bouncePattern =
    /\b(?:mailer-daemon|mail delivery subsystem|delivery status notification|undeliverable|delivery failed|address not found|recipient rejected|permanent failure)\b/iu;
  if (bouncePattern.test(searchable)) {
    return result(
      "bounce",
      0.99,
      "automated",
      "suppress",
      true,
      snippet(searchable, bouncePattern)
    );
  }

  const outOfOfficePattern =
    /\b(?:out of (?:the )?office|automatic reply|auto-reply|away from (?:the )?office|fuera de la oficina|respuesta autom[aá]tica|de vacaciones)\b/iu;
  if (autoSubmitted !== undefined || outOfOfficePattern.test(searchable)) {
    const followUpDate = extractFollowUpDate(body);
    return result(
      "out_of_office",
      0.97,
      "automated",
      followUpDate === null ? "archive" : "follow_up_later",
      false,
      snippet(searchable, outOfOfficePattern),
      followUpDate
    );
  }

  const unsubscribePattern =
    /\b(?:unsubscribe|remove me|stop (?:emailing|contacting)|do not (?:email|contact)|no me (?:escribas|contactes)|dame de baja|baja de (?:la )?lista)\b/iu;
  if (unsubscribePattern.test(body)) {
    return result(
      "unsubscribe",
      0.99,
      "negative",
      "suppress",
      true,
      snippet(body, unsubscribePattern)
    );
  }

  const complaintPattern =
    /\b(?:spam|report(?:ing)? this|privacy complaint|harassment|denuncia|protecci[oó]n de datos|esto es spam)\b/iu;
  if (complaintPattern.test(body)) {
    return result("complaint", 0.98, "negative", "suppress", true, snippet(body, complaintPattern));
  }

  const hostilePattern =
    /\b(?:leave me alone|never contact me|fuck off|vete a la mierda|no vuelvas a escribir)\b/iu;
  if (hostilePattern.test(body)) {
    return result("hostile", 0.98, "negative", "suppress", true, snippet(body, hostilePattern));
  }

  const noInterestPattern =
    /\b(?:not interested|no interest|not relevant|no thanks|no,? thank you|no me interesa|no nos interesa|no es relevante|no gracias)\b/iu;
  if (noInterestPattern.test(body)) {
    return result(
      "no_interest",
      0.96,
      "negative",
      "suppress",
      true,
      snippet(body, noInterestPattern)
    );
  }

  const wrongPersonPattern =
    /\b(?:wrong person|not the right person|I do not handle|no soy la persona|persona equivocada|no llevo (?:este|esto))\b/iu;
  if (wrongPersonPattern.test(body)) {
    return result(
      "wrong_person",
      0.94,
      "neutral",
      "update_contact",
      true,
      snippet(body, wrongPersonPattern)
    );
  }

  const referralPattern =
    /\b(?:speak to|contact|reach out to|copying|cc(?:'|’)ing|talk to|habla con|contacta con|te pongo en copia)\b.{0,120}\b(?:my|our|mi|nuestro|nuestra|colleague|colega|team|equipo|founder|fundador)\b/isu;
  if (referralPattern.test(body)) {
    return result("referral", 0.9, "positive", "handoff", false, snippet(body, referralPattern));
  }

  const laterPattern =
    /\b(?:later|next month|next quarter|not now|circle back|follow up|m[aá]s adelante|el mes que viene|pr[oó]ximo trimestre|ahora no|retomamos)\b/iu;
  if (laterPattern.test(body)) {
    const followUpDate = extractFollowUpDate(body);
    return result(
      "later",
      0.9,
      "neutral",
      followUpDate === null ? "handoff" : "follow_up_later",
      false,
      snippet(body, laterPattern),
      followUpDate
    );
  }

  const detailsPattern =
    /\b(?:send|share|tell me|more details|more information|how (?:does|would)|price|cost|proposal|env[ií]a|comparte|cu[eé]ntame|m[aá]s detalles|m[aá]s informaci[oó]n|precio|coste|propuesta)\b/iu;
  if (detailsPattern.test(body) && body.includes("?")) {
    return result(
      "asks_for_details",
      0.91,
      "positive",
      "handoff",
      false,
      snippet(body, detailsPattern)
    );
  }

  const positivePattern =
    /\b(?:interested|sounds good|let(?:'|’)s talk|book a call|happy to chat|yes,?\s|me interesa|suena bien|hablemos|agendamos|encantad[oa] de hablar|s[ií],?\s)\b/iu;
  if (positivePattern.test(body)) {
    return result("positive", 0.91, "positive", "handoff", false, snippet(body, positivePattern));
  }

  const curiousPattern =
    /\b(?:interesting|curious|worth exploring|tell me more|interesante|tengo curiosidad|podr[ií]a encajar)\b/iu;
  if (curiousPattern.test(body)) {
    return result("curious", 0.82, "positive", "handoff", false, snippet(body, curiousPattern));
  }

  return result(
    "ambiguous",
    0.5,
    "neutral",
    "manual_review",
    false,
    body === "" ? ["Empty visible reply"] : [body.slice(0, 500)]
  );
}
