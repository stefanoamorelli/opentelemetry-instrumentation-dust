# <img src="https://avatars.githubusercontent.com/u/49998002?s=200&v=4" width="32" height="32" /> <img src="https://avatars.githubusercontent.com/u/116068963?s=48&v=4" width="32" height="32" /> OpenTelemetry Instrumentation for Dust

[![npm version](https://img.shields.io/npm/v/@stefano.amorelli/opentelemetry-instrumentation-dust.svg)](https://www.npmjs.com/package/@stefano.amorelli/opentelemetry-instrumentation-dust)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL%203.0-blue.svg)](https://opensource.org/licenses/GPL-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-1.x-orange.svg)](https://opentelemetry.io/)

> [!NOTE]
> **What is this?** [Dust](https://dust.tt) is an AI agent platform for building custom assistants. [OpenTelemetry](https://opentelemetry.io/) is an observability framework for collecting traces, metrics, and logs from applications.
>
> This instrumentation package provides automatic observability using `OpenTelemetry` for `Dust` agent interactions, enabling you to monitor agent performance, track tool executions, debug failures, and analyze conversation patterns. [Read more about AI agent observability](https://opentelemetry.io/blog/2025/ai-agent-observability/).

> [!IMPORTANT]
> This is an **unofficial** and **experimental** package. It is not affiliated with or endorsed by Dust or OpenTelemetry. Breaking changes may occur between versions.

**Open source** [OpenTelemetry instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/) package for the [Dust SDK](https://github.com/dust-tt/dust) that automatically captures agent interactions as distributed traces following the [GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/).

## Installation

```bash
npm install @stefano.amorelli/opentelemetry-instrumentation-dust
# or
yarn add @stefano.amorelli/opentelemetry-instrumentation-dust
# or
pnpm add @stefano.amorelli/opentelemetry-instrumentation-dust
# or
bun add @stefano.amorelli/opentelemetry-instrumentation-dust
```

## Usage

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DustInstrumentation } from '@stefano.amorelli/opentelemetry-instrumentation-dust';

const provider = new NodeTracerProvider();
provider.register();

registerInstrumentations({
  instrumentations: [
    new DustInstrumentation({
      captureMessageContent: true,  // Capture message content (default: false)
    }),
  ],
});

// IMPORTANT: Import Dust SDK AFTER instrumentation registration
const { DustAPI } = require('@dust-tt/client');

// All Dust API calls are now automatically traced
const dustAPI = new DustAPI(
  { url: 'https://dust.tt' },
  { workspaceId: 'your-workspace-id', apiKey: 'your-api-key' }
);
```

## Span Mapping

This instrumentation maps Dust SDK operations to OpenTelemetry spans following the GenAI semantic conventions:

| Dust SDK Method | OpenTelemetry Span | Operation Name | Key Attributes |
|-----------------|-------------------|----------------|----------------|
| `createConversation()` | `invoke_agent {agent_id}` | `invoke_agent` | `gen_ai.conversation.id`<br>`gen_ai.agent.id`<br>`gen_ai.response.id`<br>`gen_ai.input.messages` (opt-in) |
| `streamAgentAnswerEvents()` | `invoke_agent` | `invoke_agent` | `gen_ai.conversation.id`<br>`gen_ai.usage.output_tokens`<br>`gen_ai.response.finish_reasons`<br>`gen_ai.output.messages` (opt-in) |
| Event: `agent_action_success` | `execute_tool` (child span) | `execute_tool` | `gen_ai.tool.name`<br>`gen_ai.tool.call.id`<br>`gen_ai.tool.call.arguments` (opt-in)<br>`gen_ai.tool.call.result` (opt-in) |

All spans include:
- `gen_ai.provider.name` = `"dust"`
- `gen_ai.operation.name` = operation type
- Error tracking via `error.type` and span status

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable instrumentation |
| `captureMessageContent` | `boolean` | `false` | Capture message content, tool arguments, and results |
| `captureSystemInstructions` | `boolean` | `false` | Capture system instructions |

> [!NOTE]
> `captureMessageContent` and `captureSystemInstructions` are **opt-in** (default: `false`) to avoid capturing sensitive data such as PII, credentials, or proprietary information. See [OpenTelemetry GenAI semantic conventions on sensitive information](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/#sensitive-information) for details.

```typescript
new DustInstrumentation({
  enabled: true,
  captureMessageContent: true,
  captureSystemInstructions: false,
})
```

## Testing

```bash
# Run automated tests
npm test

# Run manual test with real Dust API
cp .env.example .env
# Edit .env with your DUST_WORKSPACE_ID, DUST_API_KEY, and DUST_URL
npm run manual-test
```

### Visualizing Traces

<img width="3718" height="1933" alt="image" src="https://github.com/user-attachments/assets/bb5fd263-7083-4ccd-bb4c-993c3306d1db" />

For quick testing and debugging, you can visualize traces in a waterfall view using [Jaeger](https://www.jaegertracing.io/), an open-source distributed tracing platform. This shows the complete agent invocation hierarchy including tool executions and timing information.

```bash
# Start Jaeger (all-in-one Docker image for local testing)
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Run manual test with OTLP export enabled
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run manual-test

# Open Jaeger UI in your browser
# Visit http://localhost:16686 and select service "dust-manual-test"
```

## License

[GPL-3.0](LICENSE)

Copyright © 2025 [Stefano Amorelli](https://amorelli.tech) · [stefano@amorelli.tech](mailto:stefano@amorelli.tech)
