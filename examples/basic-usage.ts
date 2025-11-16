import 'dotenv/config';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DustInstrumentation } from '../src';

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
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
  console.log(`Using agent: ${agent.name} (${agent.sId})`);

  const conversationRes = await dustAPI.createConversation({
    title: 'OpenTelemetry Test',
    visibility: 'unlisted',
    message: {
      content: 'Hello! Can you help me understand OpenTelemetry?',
      mentions: [{ configurationId: agent.sId }],
      context: {
        timezone: 'UTC',
        username: 'test-user',
        email: 'test@example.com',
        fullName: 'Test User',
        origin: 'api',
      },
    },
  });

  if (conversationRes.isErr()) {
    console.error('Failed to create conversation:', conversationRes.error);
    return;
  }

  const { conversation, message: userMessage } = conversationRes.value;
  console.log(`Created conversation: ${conversation.sId}`);

  const streamRes = await dustAPI.streamAgentAnswerEvents({
    conversation,
    userMessageId: userMessage.sId,
  });

  if (streamRes.isErr()) {
    console.error('Failed to stream agent events:', streamRes.error);
    return;
  }

  console.log('Streaming agent response...');
  for await (const event of streamRes.value.eventStream) {
    switch (event.type) {
      case 'generation_tokens':
        if (event.generation?.tokens?.text) {
          process.stdout.write(event.generation.tokens.text);
        }
        break;
      case 'agent_action_success':
        console.log('\n[Tool execution]:', event.action?.type);
        break;
      case 'agent_message_success':
        console.log('\n[Agent response completed]');
        break;
      case 'agent_error':
        console.error('\n[Error]:', event.error?.message);
        break;
    }
  }

  console.log('\nDone!');
}

example().catch(console.error);
