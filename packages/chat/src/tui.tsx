import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';

export interface ChatTUIOptions {
  serverUrl: string;
  name: string;
}

export async function runChatTUI(opts: ChatTUIOptions): Promise<void> {
  const instance = render(
    <App options={opts} />,
    {
      exitOnCtrlC: false,
    },
  );

  await instance.waitUntilExit();
}
