# n8n-nodes-dropredact

[n8n](https://n8n.io/) community node for [dropredact](https://dropredact.com) — local, private PII redaction with reversible tokens.

Strip names, emails, phones, addresses, and national IDs from documents. Get consistent numbered tokens (`[PERSON_1]`, `[EMAIL_1]`). De-redact when you need the originals back. **No data leaves your server — all processing is local.**

## Installation

In your n8n instance:

1. Go to **Settings > Community Nodes**
2. Enter `n8n-nodes-dropredact`
3. Click **Install**

Or via CLI:

```bash
npm install n8n-nodes-dropredact
```

## Prerequisites

A running [dropredact](https://dropredact.com) instance. The node connects to its REST API.

**Local install:**

```bash
pip install "dropredact[api]"
dropredact --api  # starts the API on port 7700
```

**Docker:** If running n8n in Docker, run dropredact on the same Docker network and use `http://dropredact:7700` as the Host URL (Docker DNS). Do **not** use `localhost` or hardcoded IPs — they break on container restart.

## Credentials

| Field | Description | Default |
|-------|-------------|---------|
| Host URL | Base URL of your dropredact instance | `http://localhost:7700` |

The credential test calls `/health` to verify connectivity.

## Operations

### Document

| Operation | Description | Requires Pro |
|-----------|-------------|:------------:|
| **Analyze** | Detect PII spans without redacting (review flow step 1) | Yes |
| **Redact** | Redact PII from a document | Yes |
| **Redact Batch** | Redact PII from multiple documents | Yes |
| **De-Redact** | Restore original text using a token register | No |
| **De-Redact Batch** | Restore original text in multiple documents | Yes |

### Register

| Operation | Description | Requires Pro |
|-----------|-------------|:------------:|
| **List** | List all named registers on the server | No |

### System

| Operation | Description | Requires Pro |
|-----------|-------------|:------------:|
| **Health Check** | Check if the server is running | No |
| **Get License** | Get the current license tier (free/pro) | No |

## Parameters

### Detection

- **Mode:** Standard (all GDPR PII), Extended (+ORG/LOCATION), Names Only
- **Language:** Auto-detect or pick from 10 EU languages (EN, DE, FR, ES, IT, NL, PL, SV, DA, FI)
- **Confidence:** 0.30 (aggressive) to 1.0 (strict). Default 0.50.

### Output

- **Format:** Markdown, Plain Text, or DOCX

### Register

- **Register Name:** Use a server-side named register for cross-document token consistency
- **Register CSV Binary Field:** Upload a register CSV from a previous node
- **Register Passphrase:** For encrypted registers (Pro feature)

### Advanced

- **Extra Names:** Additional names to always redact
- **NER Engine:** Stanza (default) or euroPIIan (experimental)
- **OCR:** Enable for scanned PDFs (requires tesseract on the server)
- **Approved Indices:** Cherry-pick detections from a prior Analyze step

## Two-Phase Review Flow

Chain **Analyze** then **Redact** for interactive review:

1. **Analyze** returns all detected PII spans with confidence scores
2. Filter or approve detections (using n8n's IF/Filter nodes)
3. Pass approved indices to **Redact** via the "Approved Indices" field

## File Handling

The node reads files from binary properties (set by triggers, Google Drive, email, etc.) and outputs redacted/de-redacted files as binary data for downstream nodes.

**Supported input formats:** PDF, DOCX, HTML, TXT, MD (max 50 MB each)

## AI Agent Tool

This node has `usableAsTool` enabled — it works as a tool in n8n's AI agent workflows. Your AI agents can redact PII from documents before processing them, without any custom code.

## Compatibility

- n8n version 1.0+
- Node.js 18+
- Requires a running dropredact instance (self-hosted)

## License

[MIT](LICENSE)

## Links

- [dropredact](https://dropredact.com)
- [dropredact on GitHub](https://github.com/alexmavro/dropredact)
