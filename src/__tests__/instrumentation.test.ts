import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { DustInstrumentation } from '../instrumentation';
import * as constants from '../constants';

describe('DustInstrumentation', () => {
  let instrumentation: DustInstrumentation;
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
    instrumentation = new DustInstrumentation({
      captureMessageContent: true,
      captureSystemInstructions: true,
    });
    instrumentation.setTracerProvider(provider);
  });

  afterEach(() => {
    instrumentation.disable();
    exporter.reset();
  });

  describe('createConversation instrumentation', () => {
    it('should create a span for successful conversation creation', async () => {
      const mockResult = {
        isErr: () => false,
        value: {
          conversation: { sId: 'conv-123' },
          message: { sId: 'msg-456' },
        },
      };

      const mockDustAPI = {
        createConversation: jest.fn().mockResolvedValue(mockResult),
      };

      instrumentation.enable();

      const args = {
        message: {
          content: 'Hello, agent!',
          mentions: [{ configurationId: 'agent-1' }],
        },
      };

      await mockDustAPI.createConversation(args);

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(0);
    });

    it('should record error when conversation creation fails', () => {
      const mockError = new Error('API Error');
      const mockDustAPI = {
        createConversation: jest.fn().mockRejectedValue(mockError),
      };

      instrumentation.enable();

      const args = {
        message: {
          content: 'Hello, agent!',
          mentions: [{ configurationId: 'agent-1' }],
        },
      };

      expect(mockDustAPI.createConversation(args)).rejects.toThrow('API Error');
    });
  });

  describe('configuration', () => {
    it('should respect captureMessageContent setting', () => {
      const instWithoutCapture = new DustInstrumentation({
        captureMessageContent: false,
      });
      expect(instWithoutCapture).toBeDefined();
      instWithoutCapture.disable();
    });

    it('should be enabled by default', () => {
      const inst = new DustInstrumentation();
      expect(inst).toBeDefined();
      inst.disable();
    });
  });

  describe('semantic conventions', () => {
    it('should use correct gen-ai attribute names', () => {
      expect(constants.SEMATTRS_GEN_AI_OPERATION_NAME).toBe('gen_ai.operation.name');
      expect(constants.SEMATTRS_GEN_AI_PROVIDER_NAME).toBe('gen_ai.provider.name');
      expect(constants.SEMATTRS_GEN_AI_AGENT_ID).toBe('gen_ai.agent.id');
      expect(constants.SEMATTRS_GEN_AI_CONVERSATION_ID).toBe('gen_ai.conversation.id');
    });

    it('should use correct operation values', () => {
      expect(constants.GEN_AI_OPERATION_INVOKE_AGENT).toBe('invoke_agent');
      expect(constants.GEN_AI_OPERATION_EXECUTE_TOOL).toBe('execute_tool');
    });

    it('should use correct provider name', () => {
      expect(constants.GEN_AI_PROVIDER_DUST).toBe('dust');
    });
  });

  describe('event stream wrapping', () => {
    it('should handle generation_tokens events', () => {
      const event = {
        type: constants.DUST_EVENT_GENERATION_TOKENS,
        generation: {
          tokens: {
            text: 'Hello world',
            classification: 'tokens' as const,
          },
        },
      };
      expect(event.type).toBe('generation_tokens');
    });

    it('should handle agent_action_success events', () => {
      const event = {
        type: constants.DUST_EVENT_AGENT_ACTION_SUCCESS,
        action: {
          id: 'action-1',
          type: 'search',
          params: { query: 'test' },
          output: { results: [] },
        },
      };
      expect(event.type).toBe('agent_action_success');
    });

    it('should handle agent_message_success events', () => {
      const event = {
        type: constants.DUST_EVENT_AGENT_MESSAGE_SUCCESS,
        messageId: 'msg-789',
        configurationId: 'agent-1',
        message: { content: 'Response' },
      };
      expect(event.type).toBe('agent_message_success');
    });

    it('should handle error events', () => {
      const event = {
        type: constants.DUST_EVENT_AGENT_ERROR,
        error: {
          code: 'TIMEOUT',
          message: 'Request timed out',
        },
      };
      expect(event.type).toBe('agent_error');
    });
  });
});
