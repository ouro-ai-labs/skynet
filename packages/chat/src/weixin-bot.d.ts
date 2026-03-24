declare module '@pinixai/weixin-bot' {
  export interface IncomingMessage {
    userId: string;
    text: string;
    type: 'text' | 'image' | 'voice' | 'file' | 'video';
    raw: unknown;
    _contextToken: string;
    timestamp: Date;
  }

  export interface WeixinBotOptions {
    baseUrl?: string;
    tokenPath?: string;
    onError?: (error: unknown) => void;
  }

  export class WeixinBot {
    constructor(options?: WeixinBotOptions);
    login(options?: { force?: boolean }): Promise<unknown>;
    onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): this;
    reply(message: IncomingMessage, text: string): Promise<void>;
    send(userId: string, text: string): Promise<void>;
    sendTyping(userId: string): Promise<void>;
    stopTyping(userId: string): Promise<void>;
    run(): Promise<void>;
    stop(): void;
  }
}
