const { describe, it } = require('node:test');

const {
  AGENT_CLI_PROVIDERS,
  agentCliSpawnSpec,
  claudeCliArgs,
  claudeSessionArgs,
  codexNewSessionArgs,
  codexResumeSessionArgs,
  normalizeAgentCliProvider,
  normalizeCodexReasoningEffort,
  runQwenpawApi,
} = require('./agentCli');

function expectEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
  }
}

function expectIncludes(items, expected) {
  if (!items.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(items)} to include ${JSON.stringify(expected)}`);
  }
}

function expectNotIncludes(items, expected) {
  if (items.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(items)} not to include ${JSON.stringify(expected)}`);
  }
}

describe('Codex reasoning effort', () => {
  it('normalizes xhigh while preserving legacy fallbacks', () => {
    expectEqual(normalizeCodexReasoningEffort('xhigh'), 'xhigh');
    expectEqual(normalizeCodexReasoningEffort(' XHIGH '), 'xhigh');
    expectEqual(normalizeCodexReasoningEffort(''), 'medium');
    expectEqual(normalizeCodexReasoningEffort('invalid'), 'medium');
  });

  it('passes xhigh to new and resumed Codex sessions', () => {
    const expectedArg = 'model_reasoning_effort="xhigh"';

    expectIncludes(codexNewSessionArgs('D:/workspace', 'last.txt', { reasoningEffort: 'xhigh' }), expectedArg);
    expectIncludes(codexResumeSessionArgs('session-id', 'last.txt', { reasoningEffort: 'xhigh' }), expectedArg);
  });

  it('does not add Codex reasoning args to Claude CLI specs', () => {
    const spec = agentCliSpawnSpec('claude', 'claude', 'last.txt', ['-c', 'model_reasoning_effort="xhigh"']);

    expectEqual(spec.agentCliProvider, 'claude');
    expectNotIncludes(spec.args, 'model_reasoning_effort="xhigh"');
  });
});

describe('Claude session spec', () => {
  it('starts fresh Claude runs without Codex session or reasoning args', () => {
    const spec = agentCliSpawnSpec('claude', '', 'last.txt', ['resume', 'codex-session-id', '-c', 'model_reasoning_effort="xhigh"']);

    expectEqual(spec.command, 'claude');
    expectEqual(spec.agentCliProvider, 'claude');
    expectEqual(spec.promptSource, 'stdin');
    expectEqual(spec.lastFileSource, 'stdout');
    expectEqual(spec.agentCliSessionMode, 'new');
    expectEqual(spec.agentCliSessionId, '');
    expectIncludes(spec.args, '--print');
    expectIncludes(spec.args, '--output-format');
    expectIncludes(spec.args, 'text');
    expectIncludes(spec.args, '--dangerously-skip-permissions');
    expectNotIncludes(spec.args, 'resume');
    expectNotIncludes(spec.args, 'codex-session-id');
    expectNotIncludes(spec.args, 'model_reasoning_effort="xhigh"');
  });

  it('starts Claude with an explicit session id when requested', () => {
    const spec = agentCliSpawnSpec('claude', 'claude', 'last.txt', [], {
      sessionMode: 'session-id',
      sessionId: 'claude-new-session-1',
    });

    expectIncludes(claudeSessionArgs({ sessionMode: 'session-id', sessionId: 'claude-new-session-1' }), '--session-id');
    expectIncludes(spec.args, '--session-id');
    expectIncludes(spec.args, 'claude-new-session-1');
    expectEqual(spec.agentCliSessionId, 'claude-new-session-1');
    expectEqual(spec.agentCliSessionRequestedId, '');
    expectEqual(spec.agentCliSessionMode, 'session-id');
  });

  it('resumes Claude sessions with the requested session id', () => {
    const spec = agentCliSpawnSpec('claude', 'claude', 'last.txt', [], {
      agentCliSessionRequestedId: 'claude-plan-session-1',
    });

    expectIncludes(claudeCliArgs({ agentCliSessionRequestedId: 'claude-plan-session-1' }), '--resume');
    expectIncludes(spec.args, '--resume');
    expectIncludes(spec.args, 'claude-plan-session-1');
    expectEqual(spec.agentCliSessionId, 'claude-plan-session-1');
    expectEqual(spec.agentCliSessionRequestedId, 'claude-plan-session-1');
    expectEqual(spec.agentCliSessionMode, 'resume');
  });

  it('supports Claude continue mode without leaking stale session ids', () => {
    const spec = agentCliSpawnSpec('claude', 'claude', 'last.txt', [], {
      agentCliSessionMode: 'continue',
      agentCliSessionId: 'claude-stale-session',
    });

    expectIncludes(spec.args, '--continue');
    expectNotIncludes(spec.args, 'claude-stale-session');
    expectEqual(spec.agentCliSessionId, '');
    expectEqual(spec.agentCliSessionRequestedId, '');
    expectEqual(spec.agentCliSessionMode, 'continue');
  });
});

describe('OpenCode backend spec', () => {
  it('normalizes opencode and degrades unknown providers to codex', () => {
    expectIncludes([...AGENT_CLI_PROVIDERS], 'opencode');
    expectEqual(normalizeAgentCliProvider('opencode'), 'opencode');
    expectEqual(normalizeAgentCliProvider('OPENCODE'), 'opencode');
    expectEqual(normalizeAgentCliProvider('unknown-backend'), 'codex');
    expectEqual(normalizeAgentCliProvider(''), 'codex');
    expectEqual(normalizeAgentCliProvider(null), 'codex');
  });

  it('resolves the default opencode command and keeps custom command paths', () => {
    expectEqual(agentCliSpawnSpec('opencode', '', 'last.txt').command, 'opencode');
    expectEqual(agentCliSpawnSpec('opencode', '/usr/local/bin/opencode', 'last.txt').command, '/usr/local/bin/opencode');
  });

  it('produces opencode spawn args with stdout output and positional prompt', () => {
    const spec = agentCliSpawnSpec(
      'opencode',
      'opencode',
      'last.txt',
      ['-c', 'model_reasoning_effort="xhigh"', 'resume', 'session-id'],
    );

    expectEqual(spec.agentCliProvider, 'opencode');
    expectIncludes(spec.args, 'run');
    expectIncludes(spec.args, '--format');
    expectEqual(spec.promptSource, 'argument');
    expectEqual(spec.lastFileSource, 'stdout');
    expectEqual(spec.useShell, false);
  });

  it('keeps opencode specs free of Codex reasoning and session flags', () => {
    const spec = agentCliSpawnSpec(
      'opencode',
      'opencode',
      'last.txt',
      ['-c', 'model_reasoning_effort="xhigh"', 'resume'],
    );

    expectNotIncludes(spec.args, 'model_reasoning_effort');
    expectNotIncludes(spec.args, 'resume');
    expectNotIncludes(spec.args, 'session-id');
  });

  it('passes OpenCode session options as native run flags', () => {
    const spec = agentCliSpawnSpec(
      'opencode',
      'opencode',
      'last.txt',
      [],
      { sessionId: 'ses_12345', title: 'AutoPlan project 1 plan 2' },
    );

    expectIncludes(spec.args, '--session');
    expectIncludes(spec.args, 'ses_12345');
    expectIncludes(spec.args, '--title');
    expectIncludes(spec.args, 'AutoPlan project 1 plan 2');
    expectEqual(spec.agentCliSessionId, 'ses_12345');
    expectEqual(spec.agentCliSessionTitle, 'AutoPlan project 1 plan 2');
  });
});

describe('QwenPaw API provider', () => {
  it('includes qwenpaw-api in provider set', () => {
    expectIncludes([...AGENT_CLI_PROVIDERS], 'qwenpaw-api');
  });

  it('resolves qwenpaw-api provider correctly', () => {
    expectEqual(normalizeAgentCliProvider('qwenpaw-api'), 'qwenpaw-api');
    expectEqual(normalizeAgentCliProvider('QWENPAW-API'), 'qwenpaw-api');
  });

  it('produces http transport spec for qwenpaw-api', () => {
    const spec = agentCliSpawnSpec('qwenpaw-api', '', 'last.txt');

    expectEqual(spec.provider, 'qwenpaw-api');
    expectEqual(spec.agentCliProvider, 'qwenpaw-api');
    expectEqual(spec.transport, 'http');
    expectEqual(spec.promptSource, 'http-body');
    expectEqual(spec.lastFileSource, 'stdout');
    expectEqual(spec.useShell, false);
    expectIncludes(spec.apiBaseUrl, 'http://');
    expectIncludes(spec.apiBaseUrl, ':8088');
    // apiAgentId 默认值受环境变量影响，只验证非空
    expectEqual(Boolean(spec.apiAgentId), true);
  });

  it('passes custom host and port via options', () => {
    const spec = agentCliSpawnSpec(
      'qwenpaw-api',
      '',
      'last.txt',
      [],
      { qwenpawApiHost: '192.168.1.100', qwenpawApiPort: 9090, qwenpawApiAgentId: 'my-agent' },
    );

    expectIncludes(spec.apiBaseUrl, '192.168.1.100');
    expectIncludes(spec.apiBaseUrl, ':9090');
    expectEqual(spec.apiAgentId, 'my-agent');
  });

  it('passes session id through options', () => {
    const spec = agentCliSpawnSpec(
      'qwenpaw-api',
      '',
      'last.txt',
      [],
      { sessionId: 'qwenpaw-api-ses-001' },
    );

    expectEqual(spec.agentCliSessionId, 'qwenpaw-api-ses-001');
    expectEqual(spec.apiSessionId, 'qwenpaw-api-ses-001');
  });

  it('accepts qwenpawApiSessionId as alternative session key', () => {
    const spec = agentCliSpawnSpec(
      'qwenpaw-api',
      '',
      'last.txt',
      [],
      { qwenpawApiSessionId: 'api-session-002' },
    );

    expectEqual(spec.agentCliSessionId, 'api-session-002');
    expectEqual(spec.apiSessionId, 'api-session-002');
  });

  it('accepts toAgentId for apiAgentId', () => {
    const spec = agentCliSpawnSpec(
      'qwenpaw-api',
      '',
      'last.txt',
      [],
      { toAgentId: 'helper_bot' },
    );

    expectEqual(spec.apiAgentId, 'helper_bot');
  });

  it('defaults to 127.0.0.1:8088 when no options provided', () => {
    const spec = agentCliSpawnSpec('qwenpaw-api', '', 'last.txt');

    expectIncludes(spec.apiBaseUrl, 'http://127.0.0.1:8088');
  });

  it('does not include Codex reasoning args', () => {
    const spec = agentCliSpawnSpec(
      'qwenpaw-api',
      '',
      'last.txt',
      ['-c', 'model_reasoning_effort="high"'],
    );

    expectNotIncludes(spec.args, 'model_reasoning_effort');
    expectNotIncludes(spec.args, 'resume');
  });

  it('empty args array for http transport', () => {
    const spec = agentCliSpawnSpec('qwenpaw-api', '', 'last.txt');
    expectEqual(spec.args.length, 0);
  });
});

describe('QwenPaw API HTTP call', () => {
  it('returns error when connection fails', async () => {
    // 使用一个不可能的端口来测试连接失败的处理
    const result = await runQwenpawApi({
      apiBaseUrl: 'http://127.0.0.1:19999',
      apiAgentId: 'default',
      prompt: 'test',
      timeoutMs: 3000,
    });

    expectIncludes(result.error, 'QwenPaw API 连接失败');
    expectEqual(result.text, '');
  });

  it('accepts all required parameters', async () => {
    // 验证函数签名不报错（会因连接失败而返回错误，但不影响验证参数传递）
    const result = await runQwenpawApi({
      apiBaseUrl: 'http://127.0.0.1:19999',
      apiAgentId: 'autoplan',
      prompt: 'hello world',
      sessionId: 'test-session',
      userId: 'test-user',
      timeoutMs: 2000,
    });

    // 应该因连接失败而返回错误，不崩溃
    expectIncludes(result.error, '连接失败');
  });
});
