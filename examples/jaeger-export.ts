import 'dotenv/config';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { DustInstrumentation } from '../src';

const resource = Resource.default().merge(
  new Resource({
    [ATTR_SERVICE_NAME]: 'dust-example',
  })
);

const provider = new NodeTracerProvider({
  resource,
});

const exporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
});

provider.addSpanProcessor(new BatchSpanProcessor(exporter));
provider.register();

registerInstrumentations({
  instrumentations: [
    new DustInstrumentation({
      captureMessageContent: true,
      captureSystemInstructions: true,
    }),
  ],
});

// IMPORTANT: Import AFTER instrumentation is registered
const { DustAPI } = require('@dust-tt/client');

async function example() {
  if (!process.env.DUST_WORKSPACE_ID || !process.env.DUST_API_KEY || !process.env.DUST_URL) {
    console.error('Missing required environment variables. Create a .env file with:');
    console.error('  DUST_WORKSPACE_ID=your-workspace-id');
    console.error('  DUST_API_KEY=your-api-key');
    console.error('  DUST_URL=https://dust.tt');
    process.exit(1);
  }

  const dustAPI = new DustAPI(
    { url: process.env.DUST_URL },
    {
      workspaceId: process.env.DUST_WORKSPACE_ID,
      apiKey: process.env.DUST_API_KEY,
    },
    console
  );

  console.log('Creating conversation with agent...');

  const agentConfigsRes = await dustAPI.getAgentConfigurations({
    agentsGetView: 'list',
  });

  if (agentConfigsRes.isErr()) {
    console.error('Failed to get agent configurations:', agentConfigsRes.error);
    return;
  }

  const agents = agentConfigsRes.value;
  const activeAgents = agents.filter((a) => a.status === 'active');

  if (activeAgents.length === 0) {
    console.log('No active agents found');
    return;
  }

  const agent = activeAgents[0];

  const conversationRes = await dustAPI.createConversation({
    title: 'Jaeger Export Test',
    visibility: 'unlisted',
    message: {
      content: 'Explain distributed tracing',
      mentions: [{ configurationId: agent.sId }],
      context: {
        timezone: 'UTC',
        username: 'otel-user',
        origin: 'api',
      },
    },
  });

  if (conversationRes.isErr()) {
    console.error('Failed to create conversation:', conversationRes.error);
    return;
  }

  const { conversation, message: userMessage } = conversationRes.value;

  const streamRes = await dustAPI.streamAgentAnswerEvents({
    conversation,
    userMessageId: userMessage.sId,
  });

  if (streamRes.isErr()) {
    console.error('Failed to stream:', streamRes.error);
    return;
  }

  for await (const event of streamRes.value.eventStream) {
    if (event.type === 'agent_message_success') {
      console.log('Response completed!');
      break;
    }
  }

  await provider.forceFlush();
  console.log('Traces exported to Jaeger/OTLP endpoint');
  await provider.shutdown();
}

example().catch(console.error);
