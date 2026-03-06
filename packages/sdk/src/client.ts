import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import {
  type SkynetMessage,
  type AgentCard,
  type JoinRequest,
  type ServerEvent,
  ClientAction,
  deserialize,
  MessageType,
  createMessage,
} from '@skynet/protocol';

export interface SkynetClientOptions {
  serverUrl: string;
  agent: AgentCard;
  roomId: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  heartbeatInterval?: number;
}

export interface RoomState {
  roomId: string;
  members: AgentCard[];
  recentMessages: SkynetMessage[];
}

export class SkynetClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _closed = false;
  private _reconnecting = false;
  private _reconnectAttempt = 0;

  readonly agent: AgentCard;
  readonly roomId: string;
  private serverUrl: string;
  private reconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectInterval: number;
  private heartbeatInterval: number;

  constructor(options: SkynetClientOptions) {
    super();
    this.serverUrl = options.serverUrl;
    this.agent = options.agent;
    this.roomId = options.roomId;
    this.reconnect = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectInterval = options.maxReconnectInterval ?? 30000;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<RoomState> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws';
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this._connected = true;
        this._reconnecting = false;
        this._reconnectAttempt = 0;
        this.send({ action: ClientAction.JOIN, data: { roomId: this.roomId, agent: this.agent } satisfies JoinRequest });
        this.startHeartbeat();
      });

      let resolved = false;

      this.ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());

        // Server event (has 'event' field)
        if ('event' in parsed) {
          const evt = parsed as ServerEvent;
          if (evt.event === 'room.state' && !resolved) {
            resolved = true;
            resolve(evt.data as RoomState);
          } else if (evt.event === 'error') {
            this.emit('error', evt.data);
          }
          this.emit('server-event', evt);
          return;
        }

        // Regular message (has 'type' field)
        const msg = parsed as SkynetMessage;
        this.emit('message', msg);

        // Emit typed events
        switch (msg.type) {
          case MessageType.CHAT:
            this.emit('chat', msg);
            break;
          case MessageType.AGENT_JOIN:
            this.emit('agent-join', msg);
            break;
          case MessageType.AGENT_LEAVE:
            this.emit('agent-leave', msg);
            break;
          case MessageType.TASK_ASSIGN:
            this.emit('task-assign', msg);
            break;
          case MessageType.TASK_UPDATE:
            this.emit('task-update', msg);
            break;
          case MessageType.TASK_RESULT:
            this.emit('task-result', msg);
            break;
          case MessageType.CONTEXT_SHARE:
            this.emit('context-share', msg);
            break;
          case MessageType.FILE_CHANGE:
            this.emit('file-change', msg);
            break;
        }
      });

      this.ws.on('close', () => {
        this._connected = false;
        this.stopHeartbeat();

        if (this._reconnecting) {
          // During reconnection, don't emit 'disconnected' again — just schedule next attempt
          this.scheduleReconnect();
        } else {
          this.emit('disconnected');
          if (this.reconnect && !this._closed) {
            this.scheduleReconnect();
          }
        }
      });

      this.ws.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
        // Suppress error events during reconnection to avoid spam
        if (!this._reconnecting) {
          this.emit('error', err);
        }
      });
    });
  }

  sendMessage(msg: Omit<SkynetMessage, 'id' | 'timestamp' | 'from' | 'roomId'>): void {
    const fullMsg = createMessage({
      ...msg,
      from: this.agent.agentId,
      roomId: this.roomId,
    });
    this.send({ action: ClientAction.SEND, data: fullMsg });
  }

  chat(text: string, to: string | null = null, mentions?: string[]): void {
    this.sendMessage({
      type: MessageType.CHAT,
      to,
      payload: { text },
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    });
  }

  assignTask(taskId: string, title: string, description: string, assignee?: string): void {
    this.sendMessage({
      type: MessageType.TASK_ASSIGN,
      to: assignee ?? null,
      payload: { taskId, title, description, assignee, status: 'pending' },
    });
  }

  updateTask(taskId: string, status: string, assignee?: string): void {
    this.sendMessage({
      type: MessageType.TASK_UPDATE,
      to: assignee ?? null,
      payload: { taskId, status },
    });
  }

  reportTaskResult(taskId: string, success: boolean, summary: string, filesChanged?: string[]): void {
    this.sendMessage({
      type: MessageType.TASK_RESULT,
      to: null,
      payload: { taskId, success, summary, filesChanged },
    });
  }

  shareContext(files?: Array<{ path: string; content?: string }>, metadata?: Record<string, unknown>): void {
    this.sendMessage({
      type: MessageType.CONTEXT_SHARE,
      to: null,
      payload: { files, metadata },
    });
  }

  async close(): Promise<void> {
    this._closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.send({ action: ClientAction.LEAVE, data: {} });
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this._closed) return;
    this._reconnecting = true;
    this._reconnectAttempt++;
    const delay = Math.min(
      this.reconnectInterval * Math.pow(2, this._reconnectAttempt - 1),
      this.maxReconnectInterval,
    );
    this.emit('reconnecting', { attempt: this._reconnectAttempt, delay });
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // Error is handled by the 'close' event which will schedule another attempt
      });
    }, delay);
  }

  private send(envelope: { action: string; data: unknown }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({
        action: ClientAction.HEARTBEAT,
        data: { agentId: this.agent.agentId, status: this.agent.status },
      });
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
