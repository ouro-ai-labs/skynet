import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import {
  type SkynetMessage,
  type AgentCard,
  type Attachment,
  type JoinRequest,
  type ServerEvent,
  ClientAction,
  deserialize,
  MessageType,
  createMessage,
} from '@skynet-ai/protocol';

export interface SkynetClientOptions {
  serverUrl: string;
  agent: AgentCard;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectInterval?: number;
  heartbeatInterval?: number;
  /** Timestamp of the last message processed — used to skip already-seen messages on reconnect. */
  lastSeenTimestamp?: number;
}

export interface WorkspaceState {
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
  private _lastSeenTimestamp = 0;

  readonly agent: AgentCard;
  private serverUrl: string;
  private reconnect: boolean;
  private reconnectInterval: number;
  private maxReconnectInterval: number;
  private heartbeatInterval: number;

  constructor(options: SkynetClientOptions) {
    super();
    this.serverUrl = options.serverUrl;
    this.agent = options.agent;
    this.reconnect = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectInterval = options.maxReconnectInterval ?? 30000;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this._lastSeenTimestamp = options.lastSeenTimestamp ?? 0;
  }

  get lastSeenTimestamp(): number {
    return this._lastSeenTimestamp;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<WorkspaceState> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.serverUrl.replace(/^http/, 'ws') + '/ws';
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        this._connected = true;
        this._reconnecting = false;
        this._reconnectAttempt = 0;
        const joinReq: JoinRequest = { agent: this.agent };
        if (this._lastSeenTimestamp > 0) {
          joinReq.lastSeenTimestamp = this._lastSeenTimestamp;
        }
        this.send({ action: ClientAction.JOIN, data: joinReq });
        this.startHeartbeat();
      });

      let resolved = false;

      this.ws.on('message', (raw) => {
        const parsed = JSON.parse(raw.toString());

        // Server event (has 'event' field)
        if ('event' in parsed) {
          const evt = parsed as ServerEvent;
          if (evt.event === 'workspace.state') {
            if (!resolved) {
              resolved = true;
              resolve(evt.data as WorkspaceState);
            }
            // On reconnection, emit so listeners can refresh their state
            this.emit('workspace-state', evt.data as WorkspaceState);
          } else if (evt.event === 'status-change') {
            this.emit('status-change', evt.data);
          } else if (evt.event === 'error') {
            // If connect() hasn't resolved yet, reject it instead of emitting
            // (emitting 'error' with no listener throws an uncaught exception)
            if (!resolved) {
              resolved = true;
              const errData = evt.data as { message?: string };
              reject(new Error(errData.message ?? 'Server error'));
            } else {
              this.emit('error', evt.data);
            }
          }
          this.emit('server-event', evt);
          return;
        }

        // Regular message (has 'type' field)
        const msg = parsed as SkynetMessage;
        if (msg.timestamp > this._lastSeenTimestamp) {
          this._lastSeenTimestamp = msg.timestamp;
        }
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
          case MessageType.AGENT_INTERRUPT:
            this.emit('agent-interrupt', msg);
            break;
          case MessageType.AGENT_FORGET:
            this.emit('agent-forget', msg);
            break;
        }
      });

      this.ws.on('close', () => {
        this._connected = false;
        this.stopHeartbeat();

        // Reject the connect() promise if closed before workspace.state was received
        if (!resolved) {
          resolved = true;
          reject(new Error('Connection closed before workspace state was received'));
        }

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

  sendMessage(msg: Omit<SkynetMessage, 'id' | 'timestamp' | 'from'>): void {
    const fullMsg = createMessage({
      ...msg,
      from: this.agent.id,
    });
    this.send({ action: ClientAction.SEND, data: fullMsg });
  }

  chat(text: string, mentions?: string[], attachments?: Attachment[]): void {
    this.sendMessage({
      type: MessageType.CHAT,
      payload: {
        text,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      },
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    });
  }

  assignTask(taskId: string, title: string, description: string, assignee?: string): void {
    this.sendMessage({
      type: MessageType.TASK_ASSIGN,
      payload: { taskId, title, description, assignee, status: 'pending' },
    });
  }

  updateTask(taskId: string, status: string, assignee?: string): void {
    this.sendMessage({
      type: MessageType.TASK_UPDATE,
      payload: { taskId, status },
    });
  }

  reportTaskResult(taskId: string, success: boolean, summary: string, filesChanged?: string[]): void {
    this.sendMessage({
      type: MessageType.TASK_RESULT,
      payload: { taskId, success, summary, filesChanged },
    });
  }

  shareContext(files?: Array<{ path: string; content?: string }>, metadata?: Record<string, unknown>): void {
    this.sendMessage({
      type: MessageType.CONTEXT_SHARE,
      payload: { files, metadata },
    });
  }

  /** Send a heartbeat immediately (e.g. on status change) without waiting for the next interval. */
  sendHeartbeatNow(): void {
    this.send({
      action: ClientAction.HEARTBEAT,
      data: { agentId: this.agent.id, status: this.agent.status },
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
        data: { agentId: this.agent.id, status: this.agent.status },
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
