# System context

```mermaid
flowchart LR
  Mateo["Mateo"] --> Web["Internal web control plane"]
  Web --> DB[("PostgreSQL")]
  Web --> Temporal["Temporal"]
  Worker["Worker"] --> Temporal
  Worker --> DB
  Worker --> OpenAI["OpenAI provider"]
  Worker --> Gmail["Gmail provider"]
  Worker --> Search["Search/fetch providers"]
  Worker --> Storage["S3-compatible evidence storage"]
  Gmail --> Worker
  Worker --> Notify["Mateo notification"]
```

The application owns policy and state. Providers are replaceable adapters. All external content is untrusted.

## Research boundary

Search providers implement a shared port and return normalized candidates. Secure fetch independently validates DNS, pins a public address for the connection, revalidates redirects, respects robots rules, bounds response size and duration, and converts accepted public documents to inert text.

The database preserves source snapshots, hashes, evidence links, agent-run inputs/outputs, and append-only score decisions. Model output is never the final authority: entity merging requires a deterministic confidence gate, deduplication uses canonical keys, and the ICP scorer recomputes totals and actions from the fixed rubric.
