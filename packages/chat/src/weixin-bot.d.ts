declare module '@pinixai/weixin-bot' {
  export interface CDNMedia {
    encrypt_query_param: string;
    aes_key: string;
    encrypt_type?: 0 | 1;
  }

  export interface ImageItem {
    media: CDNMedia;
    aeskey?: string;
    url?: string;
    mid_size?: string | number;
    thumb_size?: string | number;
    thumb_height?: number;
    thumb_width?: number;
    hd_size?: string | number;
  }

  export const enum MessageItemType {
    TEXT = 1,
    IMAGE = 2,
    VOICE = 3,
    FILE = 4,
    VIDEO = 5,
  }

  export interface MessageItem {
    type: MessageItemType;
    text_item?: { text: string };
    image_item?: ImageItem;
    voice_item?: { media: CDNMedia; text?: string };
    file_item?: { media: CDNMedia; file_name?: string };
    video_item?: { media: CDNMedia };
  }

  export interface WeixinMessage {
    message_id: number;
    from_user_id: string;
    to_user_id: string;
    client_id: string;
    create_time_ms: number;
    message_type: number;
    message_state: number;
    context_token: string;
    item_list: MessageItem[];
  }

  export interface IncomingMessage {
    userId: string;
    text: string;
    type: 'text' | 'image' | 'voice' | 'file' | 'video';
    raw: WeixinMessage;
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
