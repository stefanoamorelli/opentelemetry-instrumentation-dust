#!/usr/bin/env bun

import 'dotenv/config';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor, ConsoleSpanExporter, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { DustInstrumentation } from './src';

console.log('🚀 Starting Manual Test of Dust OpenTelemetry Instrumentation\n');

const resource = Resource.default().merge(
  new Resource({
    [ATTR_SERVICE_NAME]: 'dust-manual-test',
  })
);

const provider = new NodeTracerProvider({ resource });

// Use OTLP exporter if endpoint is configured, otherwise use console
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const otlpExporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    timeoutMillis: 5000,
  });
  provider.addSpanProcessor(new BatchSpanProcessor(otlpExporter, {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 500,
    exportTimeoutMillis: 5000,
  }));
  console.log(`✅ Exporting traces to: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`);
  console.log('   (Make sure Jaeger is running: docker run -d --name jaeger -e COLLECTOR_OTLP_ENABLED=true -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest)\n');
} else {
  const consoleExporter = new ConsoleSpanExporter();
  provider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter));
  console.log('✅ Using ConsoleSpanExporter (set OTEL_EXPORTER_OTLP_ENDPOINT to export to Jaeger)\n');
}

provider.register();

registerInstrumentations({
  instrumentations: [
    new DustInstrumentation({
      captureMessageContent: true,
      captureSystemInstructions: true,
    }),
  ],
});

console.log('✅ Registered Dust instrumentation with message capture enabled\n');

// IMPORTANT: Import AFTER instrumentation is registered
// This allows the instrumentation to wrap the Dust SDK methods
console.log('📦 Importing Dust SDK...\n');
const { DustAPI } = require('@dust-tt/client');

async function runTest() {

  const workspaceId = process.env.DUST_WORKSPACE_ID;
  const apiKey = process.env.DUST_API_KEY;
  const url = process.env.DUST_URL;

  if (!workspaceId || !apiKey || !url) {
    console.error('❌ Missing required environment variables:');
    console.error('   DUST_WORKSPACE_ID - Your Dust workspace ID');
    console.error('   DUST_API_KEY - Your Dust API key');
    console.error('   DUST_URL - Your Dust instance URL\n');
    console.error('📝 Create a .env file with your credentials:');
    console.error('   1. Copy .env.example to .env');
    console.error('   2. Fill in your Dust workspace ID, API key, and URL\n');
    console.error('Or set them as environment variables:');
    console.error('   export DUST_WORKSPACE_ID="your-workspace-id"');
    console.error('   export DUST_API_KEY="your-api-key"');
    console.error('   export DUST_URL="https://dust.tt"\n');
    process.exit(1);
  }

  console.log(`🔗 Connecting to Dust at ${url}`);
  console.log(`   Workspace: ${workspaceId}\n`);

  const dustAPI = new DustAPI(
    { url },
    { workspaceId, apiKey },
    console
  );

  console.log('📋 Fetching available agents...\n');
  const agentConfigsRes = await dustAPI.getAgentConfigurations({
    agentsGetView: 'list',
  });

  if (agentConfigsRes.isErr()) {
    console.error('❌ Failed to get agent configurations:', agentConfigsRes.error);
    process.exit(1);
  }

  const agents = agentConfigsRes.value;
  const activeAgents = agents.filter((a) => a.status === 'active');

  console.log(`✅ Found ${agents.length} total agents, ${activeAgents.length} active\n`);

  if (activeAgents.length === 0) {
    console.error('❌ No active agents found in your workspace');
    console.error('   Please create an active agent in Dust first\n');
    process.exit(1);
  }

  // Try to find the specified agent or use first active one
  const preferredAgentId = process.env.DUST_AGENT_ID || 'gpt-5';
  let agent = activeAgents.find((a) => a.sId === preferredAgentId);

  if (!agent) {
    console.log(`⚠️  Agent "${preferredAgentId}" not found, using first active agent instead\n`);
    agent = activeAgents[0];
  }
  console.log(`🤖 Using agent: ${agent.name}`);
  console.log(`   ID: ${agent.sId}`);
  console.log(`   Description: ${agent.description || 'N/A'}\n`);

  console.log('=' .repeat(80));
  console.log('STEP 1: Testing createConversation instrumentation');
  console.log('=' .repeat(80) + '\n');

  console.log('📤 Creating conversation with a message that requires tool usage and thinking...\n');

  const conversationRes = await dustAPI.createConversation({
    title: 'OpenTelemetry Tool & Thinking Test',
    visibility: 'unlisted',
    message: {
      content: 'Can you search for information about OpenTelemetry semantic conventions and explain how they work? Please think through your answer carefully.',
      mentions: [{ configurationId: agent.sId }],
      context: {
        timezone: 'UTC',
        username: 'manual-test',
        email: 'test@example.com',
        fullName: 'Manual Test User',
        origin: 'api',
      },
    },
  });

  if (conversationRes.isErr()) {
    console.error('❌ Failed to create conversation:', conversationRes.error);
    process.exit(1);
  }

  const { conversation, message: userMessage } = conversationRes.value;
  console.log(`✅ Conversation created: ${conversation.sId}`);
  console.log(`   Message ID: ${userMessage.sId}\n`);


  console.log('=' .repeat(80));
  console.log('STEP 2: Testing streamAgentAnswerEvents instrumentation');
  console.log('=' .repeat(80) + '\n');

  console.log('📡 Streaming agent response...\n');

  const streamRes = await dustAPI.streamAgentAnswerEvents({
    conversation,
    userMessageId: userMessage.sId,
  });

  if (streamRes.isErr()) {
    console.error('❌ Failed to stream agent events:', streamRes.error);
    process.exit(1);
  }

  console.log('📨 Processing agent response...\n');
  let responseChars = 0;
  let toolExecutions = 0;
  const toolCalls: Array<{ name: string; params: any }> = [];

  for await (const event of streamRes.value.eventStream) {
    switch (event.type) {
      case 'generation_tokens':
        if (event.text && event.classification === 'tokens') {
          responseChars += event.text.length;
        }
        break;
      case 'agent_action_success':
        toolExecutions++;
        const actionType = event.action?.functionCallName || 'unknown';
        toolCalls.push({
          name: actionType,
          params: event.action?.params || {},
        });
        break;
      case 'agent_message_success':
        console.log('✅ Response completed\n');
        break;
      case 'agent_error':
        console.error('❌ Error:', event.error?.message);
        break;
    }
  }

  console.log('='.repeat(80));
  console.log('📊 Summary');
  console.log('='.repeat(80));
  console.log(`Agent: ${agent.name}`);
  console.log(`Conversation: ${conversation.sId}`);
  console.log(`Response tokens: ~${Math.ceil(responseChars / 4)} (${responseChars} chars)`);
  console.log(`Tool executions: ${toolExecutions}\n`);

  if (toolCalls.length > 0) {
    console.log('Tool Trajectory:\n');
    console.log('  START');
    toolCalls.forEach((tool, idx) => {
      console.log('    │');
      console.log('    ▼');
      console.log(`  ┌─ Tool ${idx + 1}: ${tool.name}`);

      const params = tool.params;
      const keys = Object.keys(params);
      if (keys.length > 0) {
        keys.forEach(key => {
          let value = params[key];

          if (Array.isArray(value)) {
            console.log(`  │   ${key}: [${value.length} items]`);
            value.forEach((item, i) => {
              const itemStr = typeof item === 'string' ? item : JSON.stringify(item);
              const lines = itemStr.match(/.{1,70}/g) || [itemStr];
              console.log(`  │     [${i}] ${lines[0]}`);
              lines.slice(1).forEach(line => {
                console.log(`  │         ${line}`);
              });
            });
          } else if (typeof value === 'object' && value !== null) {
            console.log(`  │   ${key}:`);
            const jsonStr = JSON.stringify(value, null, 2);
            jsonStr.split('\n').forEach(line => {
              console.log(`  │     ${line}`);
            });
          } else if (typeof value === 'string') {
            const lines = value.match(/.{1,70}/g) || [value];
            if (lines.length === 1) {
              console.log(`  │   ${key}: ${value}`);
            } else {
              console.log(`  │   ${key}:`);
              lines.forEach(line => {
                console.log(`  │     ${line}`);
              });
            }
          } else {
            console.log(`  │   ${key}: ${String(value)}`);
          }
        });
      } else {
        console.log('  │   (no parameters)');
      }
      console.log('  └─');
    });
    console.log('    │');
    console.log('    ▼');
    console.log('  END\n');
  }

  console.log('✅ Test completed\n');

  try {
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      console.log('📤 Flushing traces to OTLP endpoint...');
    }
    await provider.forceFlush();
    await new Promise(resolve => setTimeout(resolve, 500));
    await provider.shutdown();
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      console.log('✅ Traces exported successfully\n');
    }
  } catch (error) {
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      console.error('\n⚠️  Warning: Failed to export traces:', (error as Error).message);
      console.error('   Make sure Jaeger is running and accessible\n');
    }
    // Exit successfully - trace export failure shouldn't fail the test
    process.exit(0);
  }
}

runTest().catch((error) => {
  console.error('\n❌ Test failed with error:');
  console.error(error);
  process.exit(1);
});
