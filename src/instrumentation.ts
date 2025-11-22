import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { context, trace, Span, SpanKind, SpanStatusCode, Attributes } from '@opentelemetry/api';
import type { DustInstrumentationConfig, AgentEvent } from './types';
import * as constants from './constants';

const MODULE_NAME = '@dust-tt/client';
const VERSION = '1.0.0';

export class DustInstrumentation extends InstrumentationBase {
  constructor(config: DustInstrumentationConfig = {}) {
    super('@stefano.amorelli/opentelemetry-instrumentation-dust', VERSION, config);
  }

  protected init() {
    const module = new InstrumentationNodeModuleDefinition(
      MODULE_NAME,
      ['>=1.1.0'],
      (moduleExports: any) => {
        this._diag.debug('Patching Dust SDK');
        if (!moduleExports.DustAPI) {
          this._diag.error('DustAPI not found in module exports');
          return moduleExports;
        }
        this._wrap(
          moduleExports.DustAPI.prototype,
          'createConversation',
          this._patchCreateConversation.bind(this)
        );
        this._wrap(
          moduleExports.DustAPI.prototype,
          'streamAgentAnswerEvents',
          this._patchStreamAgentAnswerEvents.bind(this)
        );
        return moduleExports;
      },
      (moduleExports: any) => {
        if (moduleExports === undefined) return;
        this._diag.debug('Unpatching Dust SDK');
        this._unwrap(moduleExports.DustAPI.prototype, 'createConversation');
        this._unwrap(moduleExports.DustAPI.prototype, 'streamAgentAnswerEvents');
      }
    );
    return [module];
  }

  private _getConfig(): Required<DustInstrumentationConfig> {
    const baseConfig = this.getConfig() as DustInstrumentationConfig;
    return {
      ...baseConfig,
      enabled: baseConfig.enabled ?? true,
      captureMessageContent: baseConfig.captureMessageContent ?? false,
      captureSystemInstructions: baseConfig.captureSystemInstructions ?? false,
    };
  }

  private _patchCreateConversation(original: Function) {
    const instrumentation = this;
    return function patchedCreateConversation(this: any, args: any) {
      const config = instrumentation._getConfig();

      if (!config.enabled) {
        return original.apply(this, [args]);
      }

      const agentName = args.message?.mentions?.[0]?.configurationId || 'unknown';
      const spanName = `invoke_agent ${agentName}`;

      const tracer = instrumentation.tracer;
      const span = tracer.startSpan(
        spanName,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            [constants.SEMATTRS_GEN_AI_OPERATION_NAME]: constants.GEN_AI_OPERATION_INVOKE_AGENT,
            [constants.SEMATTRS_GEN_AI_PROVIDER_NAME]: constants.GEN_AI_PROVIDER_DUST,
            [constants.SEMATTRS_GEN_AI_AGENT_ID]: agentName,
          },
        },
        context.active()
      );

      if (args.message?.context?.email) {
        span.setAttribute(constants.SEMATTRS_ENDUSER_ID, args.message.context.email);
      }

      if (config.captureMessageContent && args.message?.content) {
        span.setAttribute(
          constants.SEMATTRS_GEN_AI_INPUT_MESSAGES,
          JSON.stringify([{ role: 'user', content: args.message.content }])
        );
      }

      return context.with(trace.setSpan(context.active(), span), () => {
        const originalPromise = original.apply(this, [args]);

        return originalPromise
          .then((result: any) => {
            if (result.isErr && result.isErr()) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: result.error?.message || 'Unknown error',
              });
              span.setAttribute(constants.SEMATTRS_ERROR_TYPE, result.error?.type || 'unknown');
            } else if (result.value) {
              span.setAttribute(
                constants.SEMATTRS_GEN_AI_CONVERSATION_ID,
                result.value.conversation?.sId
              );
              if (result.value.message?.sId) {
                span.setAttribute(constants.SEMATTRS_GEN_AI_RESPONSE_ID, result.value.message.sId);
              }
            }
            span.end();
            return result;
          })
          .catch((error: Error) => {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
            span.setAttribute(constants.SEMATTRS_ERROR_TYPE, error.name || 'Error');
            span.end();
            throw error;
          });
      });
    };
  }

  private _patchStreamAgentAnswerEvents(original: Function) {
    const instrumentation = this;
    return function patchedStreamAgentAnswerEvents(this: any, args: any) {
      const config = instrumentation._getConfig();

      if (!config.enabled) {
        return original.apply(this, [args]);
      }

      const conversation = args.conversation;
      const agentName = 'agent';
      const spanName = `invoke_agent ${agentName}`;

      const tracer = instrumentation.tracer;
      const span = tracer.startSpan(
        spanName,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            [constants.SEMATTRS_GEN_AI_OPERATION_NAME]: constants.GEN_AI_OPERATION_INVOKE_AGENT,
            [constants.SEMATTRS_GEN_AI_PROVIDER_NAME]: constants.GEN_AI_PROVIDER_DUST,
            [constants.SEMATTRS_GEN_AI_CONVERSATION_ID]: conversation.sId,
          },
        },
        context.active()
      );

      return context.with(trace.setSpan(context.active(), span), () => {
        const originalPromise = original.apply(this, [args]);

        return originalPromise
          .then(async (result: any) => {
            if (result.isErr && result.isErr()) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: result.error?.message || 'Unknown error',
              });
              span.setAttribute(constants.SEMATTRS_ERROR_TYPE, result.error?.type || 'unknown');
              span.end();
              return result;
            }

            // Wrap the event stream while preserving the Result object's methods
            const originalEventStream = result.value.eventStream;
            const wrappedEventStream = instrumentation._wrapEventStream(
              originalEventStream,
              span,
              config
            );

            // Replace the event stream in place to preserve Result object prototype
            result.value.eventStream = wrappedEventStream;

            return result;
          })
          .catch((error: Error) => {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
            span.setAttribute(constants.SEMATTRS_ERROR_TYPE, error.name || 'Error');
            span.end();
            throw error;
          });
      });
    };
  }

  private async *_wrapEventStream(
    eventStream: AsyncGenerator<AgentEvent, void, unknown>,
    span: Span,
    config: Required<DustInstrumentationConfig>
  ): AsyncGenerator<AgentEvent, void, unknown> {
    let inputTokens = 0;
    let outputTokens = 0;
    let outputContent = '';
    let agentConfig: any = null;
    let finishReason: string | null = null;
    const retrievalDocuments: any[] = [];

    try {
      for await (const event of eventStream) {
        switch (event.type) {
          case constants.DUST_EVENT_GENERATION_TOKENS:
            if (event.text) {
              outputTokens += event.text.length / 4;
              if (config.captureMessageContent) {
                outputContent += event.text;
              }
            }
            break;

          case constants.DUST_EVENT_AGENT_ACTION_SUCCESS:
            if (event.action) {
              const toolSpan = this.tracer.startSpan(
                constants.GEN_AI_OPERATION_EXECUTE_TOOL,
                {
                  kind: SpanKind.CLIENT,
                  attributes: {
                    [constants.SEMATTRS_GEN_AI_OPERATION_NAME]:
                      constants.GEN_AI_OPERATION_EXECUTE_TOOL,
                    [constants.SEMATTRS_GEN_AI_PROVIDER_NAME]: constants.GEN_AI_PROVIDER_DUST,
                    [constants.SEMATTRS_GEN_AI_TOOL_NAME]:
                      event.action.functionCallName || 'unknown',
                    [constants.SEMATTRS_GEN_AI_TOOL_CALL_ID]:
                      event.action.functionCallId || event.action.sId || 'unknown',
                  },
                },
                trace.setSpan(context.active(), span)
              );

              if (config.captureMessageContent) {
                if (event.action.params) {
                  toolSpan.setAttribute(
                    constants.SEMATTRS_GEN_AI_TOOL_CALL_ARGUMENTS,
                    JSON.stringify(event.action.params)
                  );
                }
                if (event.action.output) {
                  toolSpan.setAttribute(
                    constants.SEMATTRS_GEN_AI_TOOL_CALL_RESULT,
                    JSON.stringify(event.action.output)
                  );
                }
              }

              if (event.action.output && Array.isArray(event.action.output)) {
                for (const item of event.action.output) {
                  if (item.type === 'retrieval_documents' && item.documents) {
                    retrievalDocuments.push(...item.documents);
                  } else if (item.type === 'resource') {
                    retrievalDocuments.push(item);
                  }
                }
              }

              toolSpan.end();
            }
            break;

          case constants.DUST_EVENT_AGENT_MESSAGE_SUCCESS:
            finishReason = 'stop';
            if (event.configurationId) {
              span.setAttribute(constants.SEMATTRS_GEN_AI_AGENT_ID, event.configurationId);
            }
            if (event.messageId) {
              span.setAttribute(constants.SEMATTRS_GEN_AI_RESPONSE_ID, event.messageId);
            }
            if (event.message?.configuration) {
              const config = event.message.configuration;
              if (config.name) {
                span.setAttribute(constants.SEMATTRS_GEN_AI_AGENT_NAME, config.name);
              }
              if (config.description) {
                span.setAttribute(constants.SEMATTRS_GEN_AI_AGENT_DESCRIPTION, config.description);
              }
              if (config.version !== undefined) {
                span.setAttribute(constants.SEMATTRS_DUST_AGENT_VERSION, config.version);
              }
              if (config.versionCreatedAt) {
                span.setAttribute(constants.SEMATTRS_DUST_AGENT_VERSION_CREATED_AT, config.versionCreatedAt);
              }
            }
            break;

          case constants.DUST_EVENT_AGENT_ERROR:
          case constants.DUST_EVENT_USER_MESSAGE_ERROR:
            finishReason = 'error';
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: event.error?.message || 'Unknown error',
            });
            span.setAttribute(constants.SEMATTRS_ERROR_TYPE, event.error?.code || 'unknown');
            break;
        }

        yield event;
      }

      if (config.captureMessageContent && outputContent) {
        span.setAttribute(
          constants.SEMATTRS_GEN_AI_OUTPUT_MESSAGES,
          JSON.stringify([{ role: 'assistant', content: outputContent }])
        );
      }

      if (outputTokens > 0) {
        span.setAttribute(constants.SEMATTRS_GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
      }

      if (finishReason) {
        span.setAttribute(constants.SEMATTRS_GEN_AI_RESPONSE_FINISH_REASONS, [finishReason]);
      }

      if (retrievalDocuments.length > 0) {
        span.setAttribute(
          constants.SEMATTRS_GEN_AI_RETRIEVAL_DOCUMENTS,
          JSON.stringify(retrievalDocuments)
        );
      }

      span.end();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      span.end();
      throw error;
    }
  }
}
