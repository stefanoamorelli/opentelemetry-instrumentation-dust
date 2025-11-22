import type { InstrumentationConfig } from '@opentelemetry/instrumentation';

export interface DustInstrumentationConfig extends InstrumentationConfig {
  captureMessageContent?: boolean;
  captureSystemInstructions?: boolean;
}

export interface AgentEvent {
  type: string;
  created?: number;
  configurationId?: string;
  messageId?: string;
  text?: string;
  classification?: 'tokens' | 'chain_of_thought' | 'opening_delimiter' | 'closing_delimiter';
  delimiterClassification?: 'tokens' | 'chain_of_thought' | null;
  action?: {
    id?: number;
    sId?: string;
    functionCallName?: string;
    functionCallId?: string;
    params?: Record<string, any>;
    output?: unknown;
    status?: string;
    step?: number;
  };
  error?: {
    code?: string;
    message?: string;
  };
  message?: {
    id?: string;
    content?: string;
    configuration?: {
      sId?: string;
      name?: string;
      description?: string;
      version?: number;
      versionCreatedAt?: string | null;
    };
  };
}

export interface ConversationPublicType {
  sId: string;
  created: number;
  title?: string;
  visibility?: string;
  content?: unknown;
}

export interface AgentMessagePublicType {
  id: number;
  sId: string;
  created: number;
  visibility: string;
  version: number;
  configuration?: {
    sId: string;
    name?: string;
    description?: string;
    model?: {
      providerId?: string;
      modelId?: string;
      temperature?: number;
      maxTokens?: number;
    };
    instructions?: string;
  };
  content?: string;
}

export interface PublicPostMessagesRequestBody {
  content: string;
  mentions: Array<{
    configurationId: string;
  }>;
  context?: {
    timezone?: string;
    username?: string;
    email?: string;
    fullName?: string;
    profilePictureUrl?: string;
    origin?: string;
  };
}
